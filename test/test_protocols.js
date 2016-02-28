/* jshint node: true, mocha: true */

'use strict';

var protocols = require('../lib/protocols'),
    utils = require('../lib/utils'),
    assert = require('assert'),
    stream = require('stream'),
    util = require('util');


var HANDSHAKE_REQUEST_TYPE = protocols.HANDSHAKE_REQUEST_TYPE;
var HANDSHAKE_RESPONSE_TYPE = protocols.HANDSHAKE_RESPONSE_TYPE;
var createProtocol = protocols.createProtocol;


suite('protocols', function () {

  suite('Protocol', function () {

    test('get name and types', function () {
      var p = createProtocol({
        namespace: 'foo',
        protocol: 'HelloWorld',
        types: [
          {
            name: 'Greeting',
            type: 'record',
            fields: [{name: 'message', type: 'string'}]
          },
          {
            name: 'Curse',
            type: 'error',
            fields: [{name: 'message', type: 'string'}]
          }
        ],
        messages: {
          hello: {
            request: [{name: 'greeting', type: 'Greeting'}],
            response: 'Greeting',
            errors: ['Curse']
          },
          hi: {
          request: [{name: 'hey', type: 'string'}],
          response: 'null',
          'one-way': true
          }
        }
      });
      assert.equal(p.getName(), 'foo.HelloWorld');
      assert.equal(p.getType('foo.Greeting').getTypeName(), 'record');
    });

    test('missing message', function () {
      var ptcl = createProtocol({namespace: 'com.acme', protocol: 'Hello'});
      assert.throws(function () {
        ptcl.on('add', function () {});
      }, /unknown/);
    });

    test('missing name', function () {
      assert.throws(function () {
        createProtocol({namespace: 'com.acme', messages: {}});
      });
    });

    test('missing type', function () {
      assert.throws(function () {
        createProtocol({
          namespace: 'com.acme',
          protocol: 'HelloWorld',
          messages: {
            hello: {
              request: [{name: 'greeting', type: 'Greeting'}],
              response: 'Greeting'
            }
          }
        });
      });
    });

    test('special character in name', function () {
      var ptcl = createProtocol({
        protocol: 'Ping',
        messages: {
          'ping/1': {
            request: [],
            response: 'string'
          }
        }
      });
      var message = ptcl.getMessages()['ping/1'];
      assert.equal(message.getResponseType().getName(true), 'string');
    });

    test('get messages', function () {
      var ptcl;
      ptcl = createProtocol({protocol: 'Empty'});
      assert.deepEqual(ptcl.getMessages(), {});
      ptcl = createProtocol({
        protocol: 'Ping',
        messages: {
          ping: {
            request: [],
            response: 'string'
          }
        }
      });
      var messages = ptcl.getMessages();
      assert.equal(Object.keys(messages).length, 1);
      assert(messages.ping !== undefined);
    });

    test('create listener', function (done) {
      var ptcl = createProtocol({protocol: 'Empty'});
      var transport = new stream.PassThrough();
      var ee = ptcl.createListener(transport, function (pending) {
        assert.equal(pending, 0);
        done();
      });
      ee.destroy();
    });

    test('subprotocol', function () {
      var ptcl = createProtocol({
        namespace: 'com.acme',
        protocol: 'Hello',
        types: [{name: 'Id', type: 'fixed', size: 2}],
        messages: {ping: {request: [], response: 'null'}}
      });
      var subptcl = ptcl.subprotocol();
      assert(subptcl.getFingerprint().equals(ptcl.getFingerprint()));
      assert.strictEqual(subptcl._emitterResolvers, ptcl._emitterResolvers);
      assert.strictEqual(subptcl._listenerResolvers, ptcl._listenerResolvers);
    });

    test('invalid emitter', function (done) {
      var ptcl = createProtocol({protocol: 'Hey'});
      var ee = createProtocol({protocol: 'Hi'}).createEmitter(function () {});
      assert.throws(
        function () { ptcl.emit('hi', {}, ee); },
        /invalid emitter/
      );
      done();
    });

    test('inspect', function () {
      var p = createProtocol({
        namespace: 'hello',
        protocol: 'World',
      });
      assert.equal(p.inspect(), '<Protocol "hello.World">');
    });

  });

  suite('Message', function () {

    var Message = protocols.Message;

    test('empty errors', function () {
      var m = new Message('Hi', {
        request: [{name: 'greeting', type: 'string'}],
        response: 'int'
      });
      assert.deepEqual(m.getErrorType().toString(), '["string"]');
    });

    test('missing response', function () {
      assert.throws(function () {
        new Message('Hi', {
          request: [{name: 'greeting', type: 'string'}]
        });
      });
    });

    test('invalid one-way', function () {
      // Non-null response.
      assert.throws(function () {
        new Message('Hi', {
          request: [{name: 'greeting', type: 'string'}],
          response: 'string',
          'one-way': true
        });
      });
      // Non-empty errors.
      assert.throws(function () {
        new Message('Hi', {
          request: [{name: 'greeting', type: 'string'}],
          response: 'null',
          errors: ['int'],
          'one-way': true
        });
      });
    });

    test('getters', function () {
      var m = new Message('Ping', {
        request: [{name: 'ping', type: 'string'}],
        response: 'null'
      });
      assert.equal(m.getName(), 'Ping');
      assert.equal(m.getRequestType().getFields()[0].getName(), 'ping');
      assert.equal(m.getResponseType().getName(true), 'null');
      assert.strictEqual(m.isOneWay(), false);
    });

    test('inspect', function () {
      var m = new Message('Ping', {
        request: [{name: 'ping', type: 'string'}],
        response: 'null',
        'one-way': true
      });
      assert(m.inspect()['one-way']);
    });

  });

  suite('MessageDecoder', function () {

    var MessageDecoder = protocols.streams.MessageDecoder;

    test('ok', function (done) {
      var parts = [
        new Buffer([0, 1]),
        new Buffer([2]),
        new Buffer([]),
        new Buffer([3, 4, 5]),
        new Buffer([])
      ];
      var messages = [];
      var readable = createReadableStream(parts.map(frame), true);
      var writable = createWritableStream(messages, true)
        .on('finish', function () {
          assert.deepEqual(
            messages,
            [new Buffer([0, 1, 2]), new Buffer([3, 4, 5])]
          );
          done();
        });
      readable.pipe(new MessageDecoder()).pipe(writable);
    });

    test('trailing data', function (done) {
      var parts = [
        new Buffer([0, 1]),
        new Buffer([2]),
        new Buffer([]),
        new Buffer([3])
      ];
      var messages = [];
      var readable = createReadableStream(parts.map(frame), true);
      var writable = createWritableStream(messages, true);
      readable
        .pipe(new MessageDecoder())
        .on('error', function () {
          assert.deepEqual(messages, [new Buffer([0, 1, 2])]);
          done();
        })
        .pipe(writable);
    });

    test('empty', function (done) {
      var readable = createReadableStream([], true);
      readable
        .pipe(new MessageDecoder(true))
        .on('error', function () { done(); });
    });

  });

  suite('MessageEncoder', function () {

    var MessageEncoder = protocols.streams.MessageEncoder;

    test('invalid frame size', function () {
      assert.throws(function () { new MessageEncoder(); });
    });

    test('ok', function (done) {
      var messages = [
        new Buffer([0, 1]),
        new Buffer([2])
      ];
      var frames = [];
      var readable = createReadableStream(messages, true);
      var writable = createWritableStream(frames, true);
      readable
        .pipe(new MessageEncoder(64))
        .pipe(writable)
        .on('finish', function () {
          assert.deepEqual(
            frames,
            [
              new Buffer([0, 0, 0, 2, 0, 1, 0, 0, 0, 0]),
              new Buffer([0, 0, 0, 1, 2, 0, 0, 0, 0])
            ]
          );
          done();
        });
    });

    test('all zeros', function (done) {
      var messages = [new Buffer([0, 0, 0, 0])];
      var frames = [];
      var readable = createReadableStream(messages, true);
      var writable = createWritableStream(frames, true);
      readable
        .pipe(new MessageEncoder(64))
        .pipe(writable)
        .on('finish', function () {
          assert.deepEqual(
            frames,
            [new Buffer([0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0])]
          );
          done();
        });
    });

    test('short frame size', function (done) {
      var messages = [
        new Buffer([0, 1, 2]),
        new Buffer([2])
      ];
      var frames = [];
      var readable = createReadableStream(messages, true);
      var writable = createWritableStream(frames, true);
      readable
        .pipe(new MessageEncoder(2))
        .pipe(writable)
        .on('finish', function () {
          assert.deepEqual(
            frames,
            [
              new Buffer([0, 0, 0, 2, 0, 1, 0, 0, 0, 1, 2, 0, 0, 0, 0]),
              new Buffer([0, 0, 0, 1, 2, 0, 0, 0, 0])
            ]
          );
          done();
        });
    });

  });

  suite('StatefulEmitter', function () {

    test('ok handshake', function (done) {
      var buf = HANDSHAKE_RESPONSE_TYPE.toBuffer({match: 'BOTH'});
      var bufs = [];
      var ptcl = createProtocol({protocol: 'Empty'});
      var handshake = false;
      ptcl.createEmitter(createTransport([buf], bufs))
        .on('handshake', function (req, res) {
            handshake = true;
            assert(res.match === 'BOTH');
            assert.deepEqual(
              Buffer.concat(bufs),
              HANDSHAKE_REQUEST_TYPE.toBuffer({
                clientHash: new Buffer(ptcl._hashString, 'binary'),
                serverHash: new Buffer(ptcl._hashString, 'binary')
              })
            );
            this.destroy();
        })
        .on('eot', function () {
          assert(handshake);
          done();
        });
    });

    test('no server match handshake', function (done) {
      var ptcl = createProtocol({protocol: 'Empty'});
      var resBufs = [
        {
          match: 'NONE',
          serverHash: new Buffer(16),
          serverProtocol: ptcl.toString(),
        },
        {match: 'BOTH'}
      ].map(function (val) { return HANDSHAKE_RESPONSE_TYPE.toBuffer(val); });
      var reqBufs = [];
      var handshakes = 0;
      ptcl.createEmitter(createTransport(resBufs, reqBufs))
        .on('handshake', function (req, res) {
          if (handshakes++) {
            assert(res.match === 'BOTH');
            this.destroy();
          } else {
            assert(res.match === 'NONE');
          }
        })
        .on('eot', function () {
          assert.equal(handshakes, 2);
          done();
        });
    });

    test('incompatible protocol', function (done) {
      var ptcl = createProtocol({protocol: 'Empty'});
      var hash = new Buffer(16); // Pretend the hash was different.
      var resBufs = [
        {
          match: 'NONE',
          serverHash: hash,
          serverProtocol: ptcl.toString(),
        },
        {
          match: 'NONE',
          serverHash: hash,
          serverProtocol: ptcl.toString(),
          meta: {error: new Buffer('abcd')}
        }
      ].map(function (val) { return HANDSHAKE_RESPONSE_TYPE.toBuffer(val); });
      var error = false;
      ptcl.createEmitter(createTransport(resBufs, []))
        .on('error', function (err) {
          error = true;
          assert.equal(err.message, 'abcd');
        })
        .on('eot', function () {
          assert(error);
          done();
        });
    });

    test('handshake error', function (done) {
      var resBufs = [
        new Buffer([4, 0, 0]), // Invalid handshakes.
        new Buffer([4, 0, 0])
      ];
      var ptcl = createProtocol({protocol: 'Empty'});
      var error = false;
      ptcl.createEmitter(createTransport(resBufs, []))
        .on('error', function (err) {
          error = true;
          assert.equal(err.message, 'handshake error');
        })
        .on('eot', function () {
          assert(error);
          done();
        });
    });

    test('orphan response', function (done) {
      var ptcl = createProtocol({protocol: 'Empty'});
      var idType = protocols.IdType.createMetadataType();
      var resBufs = [
        new Buffer([0, 0, 0]), // OK handshake.
        idType.toBuffer(23)
      ];
      var error = false;
      ptcl.createEmitter(createTransport(resBufs, []))
        .on('error', function (err) {
          error = true;
          assert(/orphan response:/.test(err.message));
        })
        .on('eot', function () {
          assert(error);
          done();
        });
    });

    test('ended readable', function (done) {
      var bufs = [];
      var ptcl = createProtocol({protocol: 'Empty'});
      ptcl.createEmitter(createTransport([], bufs))
        .on('eot', function () {
          assert.equal(bufs.length, 1); // A single handshake was sent.
          done();
        });
    });

    test('interrupted', function (done) {
      var ptcl = createProtocol({
        protocol: 'Empty',
        messages: {
          id: {request: [{name: 'id', type: 'int'}], response: 'int'}
        }
      });
      var resBufs = [
        new Buffer([0, 0, 0]), // OK handshake.
      ];
      var interrupted = 0;
      var transport = createTransport(resBufs, []);
      var ee = ptcl.createEmitter(transport, function () {
        assert.equal(interrupted, 2);
        done();
      });

      ptcl.emit('id', {id: 123}, ee, cb);
      ptcl.emit('id', {id: 123}, ee, cb);

      function cb(err) {
        assert(/interrupted/.test(err));
        interrupted++;
      }
    });

    test('single client message', function (done) {
      var ptcl1 = createProtocol({
        protocol: 'Ping',
        messages: {
          ping: {request: [], response: 'string'}
        }
      });
      var ptcl2 = createProtocol({
        protocol: 'Ping',
        messages: {
          ping: {request: [], response: 'string'},
          pong: {request: [], response: 'string'}
        }
      }).on('ping', function (req, ee, cb) { cb(null, 'ok'); });
      var transports = createPassthroughTransports();
      ptcl2.createListener(transports[1]);
      var ee = ptcl1.createEmitter(transports[0]);
      ptcl1.emit('ping', {}, ee, function (err, res) {
        assert.strictEqual(err, null);
        assert.equal(res, 'ok');
        done();
      });
    });

    test('missing server message', function (done) {
      var ptcl1 = createProtocol({
        protocol: 'Ping',
        messages: {
          ping: {request: [], response: 'string'}
        }
      });
      var ptcl2 = createProtocol({protocol: 'Empty'});
      var transports = createPassthroughTransports();
      ptcl2.createListener(transports[1]);
      ptcl1.createEmitter(transports[0])
        .on('error', function (err) {
          assert(/missing server message: ping/.test(err.message));
          done();
        });
    });

    test('trailing data', function (done) {
      var ptcl = createProtocol({
        protocol: 'Ping',
        messages: {
          ping: {request: [], response: 'string'}
        }
      });
      var transports = createPassthroughTransports();
      ptcl.createEmitter(transports[0])
        .on('error', function (err) {
          assert(/trailing data/.test(err.message));
          done();
        });
      transports[0].readable.end(new Buffer([2, 3]));
    });

    test('invalid metadata', function (done) {
      var ptcl = createProtocol({
        protocol: 'Ping',
        messages: {
          ping: {request: [], response: 'string'}
        }
      });
      var transports = createPassthroughTransports();
      ptcl.createListener(transports[1]);
      ptcl.createEmitter(transports[0])
        .on('error', function (err) {
          assert(/invalid metadata/.test(err));
          done();
        })
        .on('handshake', function () {
          transports[0].readable.write(frame(new Buffer([2, 3])));
          transports[0].readable.write(frame(new Buffer(0)));
        });
    });

    test('invalid response', function (done) {
      var ptcl = createProtocol({
        protocol: 'Ping',
        messages: {
          ping: {request: [], response: 'string'}
        }
      });
      var transports = createPassthroughTransports();
      var ml = ptcl.createListener(transports[1]);
      var me = ptcl.createEmitter(transports[0])
        .on('handshake', function () {
          ml.destroy();

          ptcl.emit('ping', {}, me, function (err) {
            assert(/truncated message/.test(err.message));
            done();
          });

          var idType = protocols.IdType.createMetadataType();
          var bufs = [
              idType.toBuffer(1), // Metadata.
              new Buffer([3]) // Invalid response.
          ];
          transports[0].readable.write(frame(Buffer.concat(bufs)));
          transports[0].readable.write(frame(new Buffer(0)));
        });
    });

    test('one way', function (done) {
      var beats = 0;
      var ptcl = createProtocol({
        protocol: 'Heartbeat',
        messages: {
          beat: {request: [], response: 'null', 'one-way': true}
        }
      }).on('beat', function (req, ee, cb) {
        assert.strictEqual(cb, undefined);
        if (++beats === 2) {
          done();
        }
      });
      var transports = createPassthroughTransports();
      ptcl.createListener(transports[1]);
      var ee = ptcl.createEmitter(transports[0]);
      ptcl.emit('beat', {}, ee);
      ptcl.emit('beat', {}, ee);
    });

  });

  suite('StatelessEmitter', function () {

    test('interrupted before response data', function (done) {
      var ptcl = createProtocol({
        protocol: 'Ping',
        messages: {ping: {request: [], response: 'boolean'}}
      });
      var readable = stream.PassThrough();
      var writable = createWritableStream([]);
      var ee = ptcl.createEmitter(function (cb) {
        cb(readable);
        return writable;
      });
      ptcl.emit('ping', {}, ee, function (err) {
        assert(/interrupted/.test(err.message));
        done();
      });
      ee.destroy(true);
    });

    test('truncated response data', function (done) {
      var ptcl = createProtocol({
        protocol: 'Ping',
        messages: {ping: {request: [], response: 'string'}}
      });
      var readable = createReadableStream([
        new Buffer([0, 0, 0]), // OK handshake.
        new Buffer([8]) // Truncated string.
      ]);
      var writable = stream.PassThrough();
      var ee = ptcl.createEmitter(function (cb) {
        cb(readable);
        return writable;
      });
      ptcl.emit('ping', {}, ee, function (err) {
        assert(/no message decoded/.test(err.message));
        done();
      });
    });

  });

  suite('StatefulListener', function () {

    test('end readable', function (done) {
      var ptcl = createProtocol({protocol: 'Empty'});
      var transports = createPassthroughTransports();
      ptcl.createListener(transports[0])
        .on('eot', function (pending) {
          assert.equal(pending, 0);
          done();
        });
      transports[0].readable.end();
    });

    test('finish writable', function (done) {
      var ptcl = createProtocol({protocol: 'Empty'});
      var transports = createPassthroughTransports();
      ptcl.createListener(transports[0])
        .on('eot', function (pending) {
          assert.equal(pending, 0);
          done();
        });
      transports[0].writable.end();
    });

    test('invalid handshake', function (done) {
      var ptcl = createProtocol({protocol: 'Empty'});
      var transport = createTransport(
        [new Buffer([4])], // Invalid handshake.
        []
      );
      ptcl.createListener(transport)
        .on('handshake', function (req, res) {
          assert(!req.isValid());
          assert.equal(res.match, 'NONE');
          done();
        });
    });

    test('missing server message', function (done) {
      var ptcl1 = createProtocol({protocol: 'Empty'});
      var ptcl2 = createProtocol({
        protocol: 'Heartbeat',
        messages: {beat: {request: [], response: 'boolean'}}
      });
      var hash = new Buffer(ptcl2._hashString, 'binary');
      var req = {
        clientHash: hash,
        clientProtocol: ptcl2.toString(),
        serverHash: hash
      };
      var transport = createTransport(
        [HANDSHAKE_REQUEST_TYPE.toBuffer(req)],
        []
      );
      ptcl1.createListener(transport)
        .on('handshake', function (req, res) {
          assert(req.isValid());
          assert.equal(res.match, 'NONE');
          var msg = res.meta.error.toString();
          assert(/missing server message/.test(msg));
          done();
        });
    });

    test('invalid metadata', function (done) {
      var ptcl = createProtocol({
        protocol: 'Heartbeat',
        messages: {beat: {request: [], response: 'boolean'}}
      });
      var transports = createPassthroughTransports();
      ptcl.createListener(transports[1])
        .on('error', function (err) {
          assert(/invalid metadata/.test(err.message));
          done();
        });
      ptcl.createEmitter(transports[0])
        .on('handshake', function () {
          // Handshake is complete now.
          var writable = transports[0].writable;
          writable.write(frame(new Buffer([0]))); // Empty metadata.
          writable.write(frame(new Buffer(0)));
        });
    });

    test('unknown message', function (done) {
      var ptcl = createProtocol({
        protocol: 'Heartbeat',
        messages: {beat: {request: [], response: 'boolean'}}
      });
      var transports = createPassthroughTransports();
      var ee = ptcl.createListener(transports[1])
        .on('eot', function () {
          transports[1].writable.end();
        });
      ptcl.createEmitter(transports[0])
        .on('handshake', function () {
          // Handshake is complete now.
          this.destroy();
          var idType = ee._idType;
          var bufs = [];
          transports[0].readable
            .pipe(new protocols.streams.MessageDecoder())
            .on('data', function (buf) { bufs.push(buf); })
            .on('end', function () {
              assert.equal(bufs.length, 1);
              var tap = new utils.Tap(bufs[0]);
              idType._read(tap);
              assert(tap.buf[tap.pos++]); // Error byte.
              tap.pos++; // Union marker.
              assert(/unknown message/.test(tap.readString()));
              done();
            });
          [
            idType.toBuffer(-1),
            new Buffer([4, 104, 105]), // `hi` message.
            new Buffer(0) // End of frame.
          ].forEach(function (buf) {
            transports[0].writable.write(frame(buf));
          });
          transports[0].writable.end();
        });
    });

    test('invalid request', function (done) {
      var ptcl = createProtocol({
        protocol: 'Heartbeat',
        messages: {beat: {
          request: [{name: 'id', type: 'string'}],
          response: 'boolean'
        }}
      });
      var transports = createPassthroughTransports();
      var ee = ptcl.createListener(transports[1])
        .on('eot', function () { transports[1].writable.end(); });
      ptcl.createEmitter(transports[0])
        .on('handshake', function () {
          // Handshake is complete now.
          this.destroy();
          var idType = ee._idType;
          var bufs = [];
          transports[0].readable
            .pipe(new protocols.streams.MessageDecoder())
            .on('data', function (buf) { bufs.push(buf); })
            .on('end', function () {
              assert.equal(bufs.length, 1);
              var tap = new utils.Tap(bufs[0]);
              idType._read(tap);
              assert.equal(tap.buf[tap.pos++], 1); // Error byte.
              assert.equal(tap.buf[tap.pos++], 0); // Union marker.
              assert(/invalid request/.test(tap.readString()));
              done();
            });
          [
            idType.toBuffer(-1),
            new Buffer([8, 98, 101, 97, 116]), // `beat` message.
            new Buffer([8]), // Invalid Avro string encoding.
            new Buffer(0) // End of frame.
          ].forEach(function (buf) {
            transports[0].writable.write(frame(buf));
          });
          transports[0].writable.end();
        });
    });

    test('destroy', function (done) {
      var ptcl = createProtocol({
        protocol: 'Heartbeat',
        messages: {beat: {request: [], response: 'boolean'}}
      }).on('beat', function (req, ee, cb) {
        ee.destroy();
        setTimeout(function () { cb(null, true); }, 10);
      });
      var transports = createPassthroughTransports();
      var responded = false;
      ptcl.createListener(transports[1])
        .on('eot', function () {
          assert(responded); // Works because the transport is sync.
          done();
        });
      ptcl.emit('beat', {}, ptcl.createEmitter(transports[0]), function () {
        responded = true;
      });
    });

  });

  suite('StatelessListener', function () {

    test('unknown message', function (done) {
      var ptcl = createProtocol({
        protocol: 'Heartbeat',
        messages: {beat: {request: [], response: 'boolean'}}
      });
      var readable = new stream.PassThrough();
      var writable = new stream.PassThrough();
      var ee = ptcl.createListener(function (cb) {
        cb(writable);
        return readable;
      });
      var bufs = [];
      writable.pipe(new protocols.streams.MessageDecoder())
        .on('data', function (buf) { bufs.push(buf); })
        .on('end', function () {
          assert.equal(bufs.length, 1);
          var tap = new utils.Tap(bufs[0]);
          tap.pos = 4; // Skip handshake response.
          ee._idType._read(tap); // Skip metadata.
          assert.equal(tap.buf[tap.pos++], 1); // Error.
          assert.equal(tap.buf[tap.pos++], 0); // Union flag.
          assert(/unknown message/.test(tap.readString()));
          done();
        });
      var hash = new Buffer(ptcl._hashString, 'binary');
      var req = {
        clientHash: hash,
        clientProtocol: null,
        serverHash: hash
      };
      var encoder = new protocols.streams.MessageEncoder(64);
      encoder.pipe(readable);
      encoder.end(Buffer.concat([
        HANDSHAKE_REQUEST_TYPE.toBuffer(req),
        new Buffer([0]), // Empty metadata.
        new Buffer([4, 104, 105]) // `id` message.
      ]));
    });

    test('incompatible one-way', function (done) {
      var ptcl1 = createProtocol({
        protocol: 'Heartbeat',
        messages: {beat: {request: [], response: 'null'}}
      });
      var ptcl2 = createProtocol({
        protocol: 'Heartbeat',
        messages: {beat: {request: [], response: 'null', 'one-way': true}}
      });
      var readable = new stream.PassThrough();
      var writable = new stream.PassThrough();
      ptcl2.createListener(function (cb) {
        cb(writable);
        return readable;
      });
      var bufs = [];
      writable.pipe(new protocols.streams.MessageDecoder())
        .on('data', function (buf) { bufs.push(buf); })
        .on('end', function () {
          assert.equal(bufs.length, 1);
          var tap = new utils.Tap(bufs[0]);
          var res = HANDSHAKE_RESPONSE_TYPE._read(tap);
          assert.equal(res.match, 'NONE');
          done();
        });
      var hash = new Buffer(ptcl1._hashString, 'binary');
      var req = {
        clientHash: hash,
        clientProtocol: ptcl1.toString(),
        serverHash: hash
      };
      var encoder = new protocols.streams.MessageEncoder(64);
      encoder.pipe(readable);
      encoder.end(HANDSHAKE_REQUEST_TYPE.toBuffer(req));
    });

    test('late writable', function (done) {
      var ptcl = createProtocol({
        protocol: 'Heartbeat',
        messages: {beat: {request: [], response: 'boolean'}}
      }).on('beat', function (req, ee, cb) {
        cb(null, true);
      });
      var readable = new stream.PassThrough();
      var writable = new stream.PassThrough();
      ptcl.createListener(function (cb) {
        setTimeout(function () { cb(readable); }, 10);
        return writable;
      });
      var ee = ptcl.createEmitter(function (cb) {
        cb(readable);
        return writable;
      });
      ptcl.emit('beat', {}, ee, function (err, res) {
        assert.strictEqual(err, null);
        assert.equal(res, true);
        done();
      });
    });

  });

  suite('emit', function () {

    suite('stateful', function () {

      run(function (emitterPtcl, listenerPtcl, cb) {
        var pt1 = new stream.PassThrough();
        var pt2 = new stream.PassThrough();
        var opts = {bufferSize: 48};
        cb(
          emitterPtcl.createEmitter({readable: pt1, writable: pt2}, opts),
          listenerPtcl.createListener({readable: pt2, writable: pt1}, opts)
        );
      });

    });

    suite('stateless', function () {

      run(function (emitterPtcl, listenerPtcl, cb) {
        cb(emitterPtcl.createEmitter(writableFactory));

        function writableFactory(emitterCb) {
          var reqPt = new stream.PassThrough()
            .on('finish', function () {
              listenerPtcl.createListener(function (listenerCb) {
                var resPt = new stream.PassThrough()
                  .on('finish', function () { emitterCb(resPt); });
                listenerCb(resPt);
                return reqPt;
              });
            });
          return reqPt;
        }
      });

    });

    function run(setupFn) {

      test('primitive types', function (done) {
        var ptcl = createProtocol({
          protocol: 'Math',
          messages: {
            negate: {
              request: [{name: 'n', type: 'int'}],
              response: 'long'
            }
          }
        });
        setupFn(ptcl, ptcl, function (ee) {
          var n1, n2;
          ee.on('eot', function () {
            assert.equal(n1, 1);
            assert.equal(n2, 1);
            done();
          });
          ptcl.on('negate', function (req, ee, cb) { cb(null, -req.n); });
          n1 = ptcl.emit('negate', {n: 20}, ee, function (err, res) {
            assert.equal(this, ptcl);
            assert.strictEqual(err, null);
            assert.equal(res, -20);
            n2 = this.emit('negate', {n: 'hi'}, ee, function (err) {
              debugger;
              assert(/invalid "int"/.test(err.message));
              ee.destroy();
            });
          });
        });
      });

      test('emit receive error', function (done) {
        var ptcl = createProtocol({
          protocol: 'Math',
          messages: {
            negate: {
              request: [{name: 'n', type: 'int'}],
              response: 'long',
              errors: [{type: 'map', values: 'string'}]
            }
          }
        });
        setupFn(ptcl, ptcl, function (ee) {
          ee.on('eot', function () { done(); });
          ptcl.on('negate', function (req, ee, cb) { cb({rate: '23'}); });
          ptcl.emit('negate', {n: 20}, ee, function (err) {
            assert.equal(this, ptcl);
            assert.deepEqual(err, {rate: '23'});
            ee.destroy();
          });
        });
      });

      test('complex type', function (done) {
        var ptcl = createProtocol({
          protocol: 'Literature',
          messages: {
            generate: {
              request: [{name: 'n', type: 'int'}],
              response: {
                type: 'array',
                items: {
                  name: 'N',
                  type: 'enum',
                  symbols: ['A', 'B']
                }
              }
            }
          }
        });
        setupFn(ptcl, ptcl, function (ee) {
          var type = ptcl.getType('N');
          ee.on('eot', function () { done(); });
          ptcl.on('generate', function (req, ee, cb) {
            var letters = [];
            while (req.n--) { letters.push(type.random()); }
            cb(null, letters);
          });
          ptcl.emit('generate', {n: 20}, ee, function (err, res) {
            assert.equal(this, ptcl);
            assert.strictEqual(err, null);
            assert.equal(res.length, 20);
            ee.destroy();
          });
        });
      });

      test('invalid request', function (done) {
        var ptcl = createProtocol({
          protocol: 'Math',
          messages: {
            negate: {
              request: [{name: 'n', type: 'int'}],
              response: 'int'
            }
          }
        }).on('negate', function () { assert(false); });
        setupFn(ptcl, ptcl, function (ee) {
          ee.on('eot', function () { done(); });
          ptcl.emit('negate', {n: 'a'}, ee, function (err) {
            assert(/invalid "int"/.test(err.message), null);
            ee.destroy();
          });
        });
      });

      test('error response', function (done) {
        var ptcl = createProtocol({
          protocol: 'Math',
          messages: {
            sqrt: {
              request: [{name: 'n', type: 'float'}],
              response: 'float'
            }
          }
        }).on('sqrt', function (req, ee, cb) {
          var n = req.n;
          if (n < 0) {
            cb(new Error('must be non-negative'));
          } else {
            cb(null, Math.sqrt(n));
          }
        });
        setupFn(ptcl, ptcl, function (ee) {
          ptcl.emit('sqrt', {n: 100}, ee, function (err, res) {
            assert(Math.abs(res - 10) < 1e-5);
            ptcl.emit('sqrt', {n: - 10}, ee, function (err) {
              assert.equal(this, ptcl);
              assert(/must be non-negative/.test(err.message));
              done();
            });
          });
        });
      });

      test('wrapped error response', function (done) {
        var ptcl = createProtocol({
          protocol: 'Math',
          messages: {
            sqrt: {
              request: [{name: 'n', type: 'float'}],
              response: 'null',
              errors: ['float']
            }
          }
        }, {wrapUnions: true}).on('sqrt', function (req, ee, cb) {
          var n = req.n;
          if (n < 0) {
            cb(new Error('must be non-negative'));
          } else {
            cb({float: Math.sqrt(n)});
          }
        });
        setupFn(ptcl, ptcl, function (ee) {
          ptcl.emit('sqrt', {n: -10}, ee, function (err) {
            assert(/must be non-negative/.test(err.message));
            ptcl.emit('sqrt', {n: 100}, ee, function (err) {
              assert(Math.abs(err.float - 10) < 1e-5);
              done();
            });
          });
        });
      });

      test('invalid response', function (done) {
        var ptcl = createProtocol({
          protocol: 'Math',
          messages: {
            sqrt: {
              request: [{name: 'n', type: 'float'}],
              response: 'float'
            }
          }
        }).on('sqrt', function (req, ee, cb) {
          var n = req.n;
          if (n < 0) {
            cb(null, 'complex'); // Invalid response.
          } else {
            cb(null, Math.sqrt(n));
          }
        });
        setupFn(ptcl, ptcl, function (ee) {
          ptcl.emit('sqrt', {n: - 10}, ee, function (err) {
            // The server error message is propagated to the client.
            assert(/invalid "float"/.test(err.message));
            ptcl.emit('sqrt', {n: 100}, ee, function (err, res) {
              // And the server doesn't die (we can make a new request).
              assert(Math.abs(res - 10) < 1e-5);
              done();
            });
          });
        });
      });

      test('invalid strict error', function (done) {
        var ptcl = createProtocol({
          protocol: 'Math',
          messages: {
            sqrt: {
              request: [{name: 'n', type: 'float'}],
              response: 'float'
            }
          }
        }, {strictErrors: true}).on('sqrt', function (req, ee, cb) {
          var n = req.n;
          if (n === -1) {
            cb(new Error('no i')); // Invalid error (should be a string).
          } else if (n < 0) {
            cb({error: 'complex'}); // Also invalid error.
          } else {
            cb(undefined, Math.sqrt(n));
          }
        });
        setupFn(ptcl, ptcl, function (ee) {
          ptcl.emit('sqrt', {n: -1}, ee, function (err) {
            assert(/invalid \["string"\]/.test(err));
            ptcl.emit('sqrt', {n: -2}, ee, function (err) {
              assert(/invalid \["string"\]/.test(err));
              ptcl.emit('sqrt', {n: 100}, ee, function (err, res) {
                // The server still doesn't die (we can make a new request).
                assert.strictEqual(err, undefined);
                assert(Math.abs(res - 10) < 1e-5);
                done();
              });
            });
          });
        });
      });

      test('out of order', function (done) {
        var ptcl = createProtocol({
          protocol: 'Delay',
          messages: {
            wait: {
              request: [
                {name: 'ms', type: 'float'},
                {name: 'id', type: 'string'}
              ],
              response: 'string'
            }
          }
        }).on('wait', function (req, ee, cb) {
          var delay = req.ms;
          if (delay < 0) {
            cb('delay must be non-negative');
            return;
          }
          setTimeout(function () { cb(null, req.id); }, delay);
        });
        var ids = [];
        setupFn(ptcl, ptcl, function (ee) {
          ee.on('eot', function (pending) {
            assert.equal(pending, 0);
            assert.equal(n1, 1);
            assert.equal(n2, 2);
            assert.equal(n3, 3);
            assert.deepEqual(ids, [null, 'b', 'a']);
            done();
          });
          var n1, n2, n3;
          n1 = ptcl.emit('wait', {ms: 500, id: 'a'}, ee, function (err, res) {
            assert.strictEqual(err, null);
            ids.push(res);
          });
          n2 = ptcl.emit('wait', {ms: 10, id: 'b'}, ee, function (err, res) {
            assert.strictEqual(err, null);
            ids.push(res);
            ee.destroy();
          });
          n3 = ptcl.emit('wait', {ms: -100, id: 'c'}, ee, function (err, res) {
            assert(/non-negative/.test(err));
            ids.push(res);
          });
        });
      });

      test('compatible protocols', function (done) {
        var emitterPtcl = createProtocol({
          protocol: 'emitterProtocol',
          messages: {
            age: {
              request: [{name: 'name', type: 'string'}],
              response: 'long'
            }
          }
        });
        var listenerPtcl = createProtocol({
          protocol: 'serverProtocol',
          messages: {
            age: {
              request: [
                {name: 'name', type: 'string'},
                {name: 'address', type: ['null', 'string'], 'default': null}
              ],
              response: 'int'
            },
            id: {
              request: [{name: 'name', type: 'string'}],
              response: 'long'
            }
          }
        });
        setupFn(
          emitterPtcl,
          listenerPtcl,
          function (ee) {
            listenerPtcl.on('age', function (req, ee, cb) {
              assert.equal(req.name, 'Ann');
              cb(null, 23);
            });
            emitterPtcl.emit('age', {name: 'Ann'}, ee, function (err, res) {
              assert.strictEqual(err, null);
              assert.equal(res, 23);
              done();
            });
          }
        );
      });

      test('compatible protocol with a complex type', function (done) {
        var ptcl1 = createProtocol({
          protocol: 'Literature',
          messages: {
            generate: {
              request: [{name: 'n', type: 'int'}],
              response: {
                type: 'array',
                items: {
                  name: 'N',
                  aliases: ['N2'],
                  type: 'enum',
                  symbols: ['A', 'B', 'C', 'D']
                }
              }
            }
          }
        });
        var ptcl2 = createProtocol({
          protocol: 'Literature',
          messages: {
            generate: {
              request: [{name: 'n', type: 'int'}],
              response: {
                type: 'array',
                items: {
                  name: 'N2',
                  aliases: ['N'],
                  type: 'enum',
                  symbols: ['A', 'B']
                }
              }
            }
          }
        });
        setupFn(ptcl1, ptcl2, function (ee) {
          var type = ptcl2.getType('N2');
          ee.on('eot', function () { done(); });
          ptcl2.on('generate', function (req, ee, cb) {
            var letters = [];
            while (req.n--) { letters.push(type.random()); }
            cb(null, letters);
          });
          ptcl1.emit('generate', {n: 20}, ee, function (err, res) {
            assert.equal(this, ptcl1);
            assert.strictEqual(err, null);
            assert.equal(res.length, 20);
            ee.destroy();
          });
        });
      });

      test('cached compatible protocols', function (done) {
        var ptcl1 = createProtocol({
          protocol: 'emitterProtocol',
          messages: {
            age: {
              request: [{name: 'name', type: 'string'}],
              response: 'long'
            }
          }
        });
        var ptcl2 = createProtocol({
          protocol: 'serverProtocol',
          namespace: 'foo',
          messages: {
            age: {
              request: [
                {name: 'name', type: 'string'},
                {name: 'address', type: ['null', 'string'], 'default': null}
              ],
              response: 'int'
            },
            id: {
              request: [{name: 'name', type: 'string'}],
              response: 'long'
            }
          }
        }).on('age', function (req, ee, cb) { cb(null, 48); });
        setupFn(
          ptcl1,
          ptcl2,
          function (ee1) {
            ptcl1.emit('age', {name: 'Ann'}, ee1, function (err, res) {
              assert.equal(res, 48);
              setupFn(
                ptcl1,
                ptcl2,
                function (ee2) { // ee2 has the server's protocol.
                  ptcl1.emit('age', {name: 'Bob'}, ee2, function (err, res) {
                    assert.equal(res, 48);
                    done();
                  });
                }
              );
            });
          }
        );
      });

      test('incompatible protocols', function (done) {
        var emitterPtcl = createProtocol({
          protocol: 'emitterProtocol',
          messages: {
            age: {request: [{name: 'name', type: 'string'}], response: 'long'}
          }
        }, {wrapUnions: true});
        var listenerPtcl = createProtocol({
          protocol: 'serverProtocol',
          messages: {
            age: {request: [{name: 'name', type: 'int'}], response: 'long'}
          }
        }).on('age', function (req, ee, cb) { cb(null, 0); });
        setupFn(
          emitterPtcl,
          listenerPtcl,
          function (ee) {
            ee.on('error', function () { debugger; }); // For stateful protocols.
            emitterPtcl.emit('age', {name: 'Ann'}, ee, function (err) {
              debugger;
              assert(err.message);
              done();
            });
          }
        );
      });

      test('incompatible protocols one way message', function (done) {
        var ptcl1 = createProtocol({
          protocol: 'ptcl1',
          messages: {ping: {request: [], response: 'null', 'one-way': true}}
        });
        var ptcl2 = createProtocol({
          protocol: 'ptcl2',
          messages: {ping: {request: [], response: 'null'}}
        });
        setupFn(ptcl1, ptcl2, function (ee) {
            ee.on('error', function (err) {
              // The error will be emitter directly in the case of stateful
              // emitters and wrapped when stateless.
              assert(
                /incompatible/.test(err) ||
                /incompatible/.test(err.cause)
              );
              done();
            });
            ptcl1.emit('ping', {}, ee);
          }
        );
      });

      test('one way message', function (done) {
        var ptcl = createProtocol({
          protocol: 'ptcl',
          messages: {ping: {request: [], response: 'null', 'one-way': true}}
        });
        setupFn(ptcl, ptcl, function (ee) {
          ptcl.on('ping', function (req, ee, cb) {
            assert.strictEqual(cb, undefined);
            done();
          });
          ptcl.emit('ping', {}, ee);
        });
      });

      test('ignored response', function (done) {
        var ptcl = createProtocol({
          protocol: 'ptcl',
          messages: {ping: {request: [], response: 'null'}} // Not one-way.
        });
        setupFn(ptcl, ptcl, function (ee) {
          ptcl.on('ping', function (req, ee, cb) {
            cb(null, null);
            done();
          });
          ptcl.emit('ping', {}, ee);
        });
      });

      test('unknown message', function (done) {
        var ptcl = createProtocol({protocol: 'Empty'});
        setupFn(ptcl, ptcl, function (ee) {
          assert.throws(
            function () { ptcl.emit('echo', {}, ee); },
            /unknown message/
          );
          done();
        });
      });

      test('unhandled message', function (done) {
        var ptcl = createProtocol({
          protocol: 'Echo',
          messages: {
            echo: {
              request: [{name: 'id', type: 'string'}],
              response: 'string'
            },
            ping: {request: [], response: 'null', 'one-way': true}
          }
        });
        setupFn(ptcl, ptcl, function (ee) {
          ptcl.emit('echo', {id: ''}, ee, function (err) {
            assert(/unhandled/.test(err.message));
            ptcl.emit('ping', {}, ee);
            // By definition of one-way, there is no reliable way of calling
            // done exactly when ping is done, so we add a small timeout.
            setTimeout(done, 100);
          });
        });
      });

      test('destroy emitter noWait', function (done) {
        var ptcl = createProtocol({
          protocol: 'Delay',
          messages: {
            wait: {
              request: [{name: 'ms', type: 'int'}],
              response: 'string'
            }
          }
        }).on('wait', function (req, ee, cb) {
            setTimeout(function () { cb(null, 'ok'); }, req.ms);
          });
        var interrupted = 0;
        var eoted = false;
        setupFn(ptcl, ptcl, function (ee) {
          ee.on('eot', function (pending) {
            eoted = true;
            assert.equal(interrupted, 2);
            assert.equal(pending, 2);
            done();
          });
          ptcl.emit('wait', {ms: 75}, ee, interruptedCb);
          ptcl.emit('wait', {ms: 50}, ee, interruptedCb);
          ptcl.emit('wait', {ms: 10}, ee, function (err, res) {
            assert.equal(res, 'ok');
            ee.destroy(true);
          });

          function interruptedCb(err) {
            assert(/interrupted/.test(err.message));
            interrupted++;
          }
        });
      });

      test('destroy emitter', function (done) {
        var ptcl = createProtocol({
          protocol: 'Math',
          messages: {
            negate: {
              request: [{name: 'n', type: 'int'}],
              response: 'int'
            }
          }
        });
        setupFn(ptcl, ptcl, function (ee) {
          ptcl.on('negate', function (req, ee, cb) { cb(null, -req.n); });
          ptcl.emit('negate', {n: 20}, ee, function (err, res) {
            assert.strictEqual(err, null);
            assert.equal(res, -20);
            ee.destroy();
            this.emit('negate', {n: 'hi'}, ee, function (err) {
              assert(/destroyed/.test(err.message));
              done();
            });
          });
        });
      });

      test('catch server error', function (done) {
        var ptcl = createProtocol({
          protocol: 'Math',
          messages: {
            error1: {request: [], response: 'null'},
            error2: {request: [], response: 'null', 'one-way': true},
            negate: {
              request: [{name: 'n', type: 'int'}],
              response: 'int'
            }
          }
        });
        setupFn(ptcl, ptcl, function (ee) {
          ptcl
            .on('error1', function () { throw new Error('foobar'); })
            .on('error2', function () { throw new Error('foobar'); })
            .on('negate', function (req, ee, cb) { cb(null, -req.n); })
            .emit('error1', {}, ee, function (err) {
              assert(/foobar/.test(err));
              // But the server doesn't die.
              this.emit('error2', {}, ee);
              this.emit('negate', {n: 20}, ee, function (err, res) {
                assert.strictEqual(err, null);
                assert.equal(res, -20);
                done();
              });
            });
        });
      });

    }

  });

});

// Helpers.

// Message framing.
function frame(buf) {
  var framed = new Buffer(buf.length + 4);
  framed.writeInt32BE(buf.length);
  buf.copy(framed, 4);
  return framed;
}

function createReadableTransport(bufs, frameSize) {
  return createReadableStream(bufs)
    .pipe(new protocols.streams.MessageEncoder(frameSize || 64));
}

function createWritableTransport(bufs) {
  var decoder = new protocols.streams.MessageDecoder();
  decoder.pipe(createWritableStream(bufs));
  return decoder;
}

function createTransport(readBufs, writeBufs) {
  return toDuplex(
    createReadableTransport(readBufs),
    createWritableTransport(writeBufs)
  );
}

function createPassthroughTransports() {
  var pt1 = stream.PassThrough();
  var pt2 = stream.PassThrough();
  return [{readable: pt1, writable: pt2}, {readable: pt2, writable: pt1}];
}

// Simplified stream constructor API isn't available in earlier node versions.

function createReadableStream(bufs) {
  var n = 0;
  function Stream() { stream.Readable.call(this); }
  util.inherits(Stream, stream.Readable);
  Stream.prototype._read = function () {
    this.push(bufs[n++] || null);
  };
  var readable = new Stream();
  return readable;
}

function createWritableStream(bufs) {
  function Stream() { stream.Writable.call(this); }
  util.inherits(Stream, stream.Writable);
  Stream.prototype._write = function (buf, encoding, cb) {
    bufs.push(buf);
    cb();
  };
  return new Stream();
}

// Combine two (binary) streams into a single duplex one. This is very basic
// and doesn't handle a lot of cases (e.g. where `_read` doesn't return
// something).
function toDuplex(readable, writable) {
  function Stream() {
    stream.Duplex.call(this);
    this.on('finish', function () { writable.end(); });
  }
  util.inherits(Stream, stream.Duplex);
  Stream.prototype._read = function () {
    this.push(readable.read());
  };
  Stream.prototype._write = function (buf, encoding, cb) {
    writable.write(buf);
    cb();
  };
  return new Stream();
}
