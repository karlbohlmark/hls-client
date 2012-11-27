var m3u8 = require('m3u8');
var fs   = require('fs');
var path = require('path');
var Url = require('url');
var request = require('request');
var commander = require('commander');
var util = require('util');
var Emitter = require('events').EventEmitter;
var log = require('winston');
var useragent = require('useragents');

var program = require('commander')
  .usage('[options] <manifest-url>')
  .option('--os <windows|osx>', 'Operating system', 'windows')
  .option('--browser <firefox|chrome|ie>', 'Browser', 'chrome')
  .option('--version <version>', 'Browser version number', 23)
  .option('-c, --count <count>', 'Number of clients', 1)
  .option('-b, --bandwidth <n>', 'Bandwidth', 1160000)
  .parse(process.argv);

if (!program.args.length) {
  program.help();
}

function StreamingSession (bandwidth, useragent) {
  this.bandwidth = bandwidth;
  this.useragent = useragent;
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

StreamingSession.prototype.request = function (url) {
  return request({url: url, headers: {'User-Agent': this.useragent}});
};

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
  var request = this.request(url);
  this.streamingState.request = request;
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

var info = log.info.bind(log);

for(var i = 0; i < program.count; i++) {
  var session = new StreamingSession(bandwidth, useragent(program.browser, program.os, program.version));
  session.enqueManifest(url);
  session.start();
  session.on('mediasegment-done', info);
}