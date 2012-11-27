var m3u8 = require('m3u8');
var fs   = require('fs');
var path = require('path');
var Url = require('url');
var request = require('request');
var commander = require('commander');
var util = require('util');
var Emitter = require('events').EventEmitter;
var log = require('winston');

var program = require('commander')
  .usage('[options] <manifest-url>')
  .option('-b, --bandwidth <n>', 'Bandwidth', 1160000)
  .parse(process.argv);

if (!program.args.length) {
  program.help();
}
/*
function fetchManifest (url, cb) {
  log.info('FETCH:', url);
  var parser = m3u8.createStream();
  var req = request(url);
  req.on('error', cb);
  parser.on('m3u', cb.bind(null, null));
  req.pipe(parser);
}

function onerror(err) {
  console.log(err.code);
}

function reportIfError (cb) {
  var f = function (err) {
    if (err) throw err;
    var args = [].slice.call(arguments, 1);
    //console.log('report', args);
    cb.apply(null, args);
  };
  f.name = cb.name + '_wrap';
  return f;
}
*/
function StreamingSession (bandwidth) {
  this.bandwidth = bandwidth;
  this.mediaSegmentQueue = [];
  this.manifestQueue = [];
  this.manifestQueue.emit = Emitter.prototype.emit;
  Emitter.call(this.manifestQueue);
  this.manifestQueue.push = function (item) {
    Array.prototype.push.call(this, item);
    this.emit('item', item);
  };
  
  this.streamingState = { fetching: false };
  this.manifestFetchingState = { fetching: false };

  this.on('manifest', this.streamManifest.bind(this));
  this.on('mediasegment-done', this.fetchNextMediaSegment.bind(this));
}

util.inherits(StreamingSession, Emitter);

StreamingSession.prototype.request = request;

StreamingSession.prototype.bandwidthOfStreamItem = function (streamItem) {
  return streamItem.attributes.attributes.bandwidth;
};

StreamingSession.prototype.chooseStream = function (streamItems, bandwidth) {
  var chosenItem;
  var lowerBandwidth = streamItems.filter(function (item) {
    return this.bandwidthOfStreamItem(item) < bandwidth;
  }.bind(this));

  if (lowerBandwidth.length) {
    chosenItem = lowerBandwidth[0];
  } else {
    chosenItem = streamItems[0];
  }
  return chosenItem.properties.uri;
};

StreamingSession.prototype.hasMultipleManifests = function (manifest) {
  return manifest.items.StreamItem && manifest.items.StreamItem.length;
};

StreamingSession.prototype.streamManifest = function (manifest) {
  if (this.hasMultipleManifests(manifest)) {
    var nextManifest = this.chooseStream(manifest.items.StreamItem, this.bandwidth);
    var manifestPath = Url.resolve(this.manifestFetchingState.url, nextManifest);
    this.fetchManifest(manifestPath);
  } else if (true) {
    log.info('Start streaming media');
    manifest.items.PlaylistItem.forEach(function (item) {
      var absUrl = Url.resolve(this.manifestFetchingState.url, item.properties.uri);
      this.enqueMediaSegment(absUrl);
    }.bind(this));
    //fetchManifest(manifestPath, reportIfError(streamFromManifest.bind(null, manifestPath)));
  }
};

StreamingSession.prototype.enqueMediaSegment = function (url) {
  log.info('enqueMediaSegment: ' + url);
  this.mediaSegmentQueue.push(url);
  if (!this.streamingState.fetching) {
    this.fetchNextMediaSegment();
  }
};

StreamingSession.prototype.fetchNextMediaSegment = function () {
  var segment = this.mediaSegmentQueue.pop();
  if (segment) {
    this.fetchMedia(segment);
  } else {

  }
};

StreamingSession.prototype.fetchMedia = function (url) {
  log.info('fetchMedia: ' + url);
  this.streamingState.url = url;
  this.streamingState.fetching = true;
  var request = this.streamingState.request = this.request(url);
  request.on('end', function () {
    this.emit('mediasegment-done', url);
  }.bind(this));
};


StreamingSession.prototype.start = function StreamingSessionStart(url) {
  if (url) {
    this.enqueManifest(url);
  }
  this.fetchNextManifest();
};

StreamingSession.prototype.fetchNextManifest = function () {
  var next = this.manifestQueue.pop();
  if (next) {
    this.fetchManifest(next.url);
  } else {
    this.emit('drain');
  }
};

StreamingSession.prototype.fetchManifest = function (manifestUrl) {
  this.manifestFetchingState.url = manifestUrl;
  this.manifestFetchingState.fetching = true;
  var parser = m3u8.createStream();
  this.request(manifestUrl).pipe(parser);
  parser.on('m3u', function (m3u) {
    this.emit('manifest', m3u);
  }.bind(this));
};

StreamingSession.prototype.enqueManifest = function (url) {
  log.info('enqueue', url);
  this.manifestQueue.push({url: url});
};

var url = program.args[0];
var bandwidth = program.bandwidth;

var session = new StreamingSession(bandwidth);
session.enqueManifest(url);
session.on('mediasegment-done', function (url) {
  log.info('media segmented streamed: ' + url);
});
session.start();