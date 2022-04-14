"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.init = exports.write = exports.onGps = void 0;

var _serialport = _interopRequireDefault(require("serialport"));

var _parserReadline = _interopRequireDefault(require("@serialport/parser-readline"));

var _gps = _interopRequireDefault(require("gps"));

var _logger = require("../logger");

var _powerBtn = require("./powerBtn");

var _config = _interopRequireDefault(require("../config.json"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }

function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }

_logger.mlog.debug('Initilizing port');

var port = new _serialport.default(_config.default.modemSerial, {
  baudRate: 115200
});
var commandsQueue = [];
var gpsHandlers = [];
var gps = new _gps.default();
var modemParser = port.pipe(new _parserReadline.default());
var currentCommand;
var dataBuffer = '';

_logger.mlog.debug('setting up event handlers');

modemParser.on('data',
/*#__PURE__*/
function () {
  var _ref = _asyncToGenerator(function* (data) {
    if (!data) {
      return;
    }

    if (data.length && data[0] === '$') {
      gps.update(data);
      return;
    }

    if (currentCommand) {
      // eslint-disable-next-line no-param-reassign
      data = data.trim(); // log.debug('Received from modem');

      _logger.mlog.debug("<<<".concat(data));

      if (data === currentCommand.command) {
        return;
      }

      var firstStrRespCommands = ['AT+CIFSR'];

      if (firstStrRespCommands.indexOf(currentCommand.command) > -1) {
        currentCommand.resolve(data);
        dataBuffer = '';
        clearTimeout(currentCommand.timeoutHandle);
        currentCommand = undefined;
        return;
      }

      if (currentCommand.command.indexOf('AT+HTTPDATA') > -1) {
        if (data.indexOf('DOWNLOAD') > -1) {
          currentCommand.resolve(data);
          dataBuffer = '';
          clearTimeout(currentCommand.timeoutHandle);
          currentCommand = undefined;
          return;
        }
      }

      var commands = ['CGNSPWR', 'HTTPACTION'];

      for (var i = 0; i < commands.length; i += 1) {
        if (currentCommand.command.indexOf("AT+".concat(commands[i])) > -1) {
          if (data.indexOf("+".concat(commands[i], ":")) > -1) {
            currentCommand.resolve(data);
            dataBuffer = '';
            clearTimeout(currentCommand.timeoutHandle);
            currentCommand = undefined;
          } else {
            dataBuffer += data;
          }

          return;
        }
      }

      switch (data) {
        case 'OK':
          currentCommand.resolve(dataBuffer);
          dataBuffer = '';
          clearTimeout(currentCommand.timeoutHandle);
          currentCommand = undefined;
          break;

        case 'ERROR':
          currentCommand.reject(dataBuffer);
          dataBuffer = '';
          clearTimeout(currentCommand.timeoutHandle);
          currentCommand = undefined;
          break;

        default:
          dataBuffer += data && data !== currentCommand.command ? "".concat(data, "\n") : '';
      }
    }
  });

  return function (_x) {
    return _ref.apply(this, arguments);
  };
}());
gps.on('data', gpsData => {
  if (gpsData.type === 'GGA') {
    gpsHandlers.forEach(h => h(gpsData));
  }
});
setInterval(() => {
  if (currentCommand) {
    return;
  }

  currentCommand = commandsQueue.length && commandsQueue[0];

  if (currentCommand) {
    // log.debug('Command readed from buffer');
    commandsQueue.splice(0, 1); // log.debug('Sending to the modem');

    port.write("".concat(currentCommand.command, '\n'));

    _logger.mlog.debug(">>>".concat(currentCommand.command));

    currentCommand.timeoutHandle = setTimeout(() => {
      _logger.mlog.error('Timeout Error');

      dataBuffer = '';
      currentCommand.reject('Timeout error');
      currentCommand = undefined;
    }, currentCommand.timeout);
  }
}, 0);

var onGps = gpsHandler => {
  gpsHandlers.push(gpsHandler);
};

exports.onGps = onGps;

var write = function write(command) {
  var timeout = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 10000;
  return new Promise((resolve, reject) => {
    commandsQueue.push({
      command,
      resolve,
      reject,
      timeout,
      timeoutHandle: null
    });
  });
};

exports.write = write;

var init =
/*#__PURE__*/
function () {
  var _ref2 = _asyncToGenerator(function* () {
    _logger.mlog.debug('Starting to initialize modem');

    try {
      try {
        _logger.mlog.debug('running AT Command');

        yield write('AT');

        _logger.mlog.debug('Success');
      } catch (ex) {
        _logger.mlog.debug(ex.message);

        _logger.mlog.debug('Looks like the modem is off, pressing power button for 4 sec...');

        yield (0, _powerBtn.pressPower)();

        _logger.mlog.debug('Running AT command again');

        yield write('AT').catch(err => {
          throw new Error(err);
        });
      }

      try {
        var sapResp = yield write('AT+SAPBR=2,1');
        var resArr = sapResp.trim().split(' ')[1].split(',');

        if (resArr[1] === '3') {
          _logger.mlog.debug('Modem not connected to the Intenet');

          _logger.mlog.debug('Setting up the APN');

          yield write("AT+SAPBR=3,1,\"APN\",\"".concat(_config.default.apn, "\""));

          _logger.mlog.debug('Connecting to the Intenet'); // eslint-disable-next-line no-constant-condition


          while (true) {
            try {
              // eslint-disable-next-line no-await-in-loop
              yield write('AT+SAPBR=1,1', 20000);
              break;
            } catch (ex) {
              _logger.mlog.error('Error connecting to the internet, trying One more time...');
            }
          }
        } else if (resArr[1] === '1') {
          _logger.mlog.debug("Modem connected with ip: \"".concat(resArr[2], "\""));
        } else {
          throw new Error(sapResp);
        }

        _logger.mlog.debug("Modem Successfully Initialized");

        _logger.mlog.debug("Setting up the GPS");

        try {
          _logger.mlog.debug("Turned on the GPS");

          yield write('AT+CGNSPWR=1', 10000);
        } catch (ex) {
          _logger.mlog.debug("GPS already Turned on");
        }

        _logger.mlog.debug("Setting GPS Baud rate to 115200");

        yield write('AT+CGNSIPR=115200');

        _logger.mlog.debug("Starting to receive data");

        yield write('AT+CGNSTST=1');

        _logger.mlog.debug("GPS Successfully initialized"); //      resp: +SAPBR: 1,3,"0.0.0.0"

      } catch (ex) {
        throw new Error(ex);
      } 

    } catch (err) {
      _logger.mlog.debug(err);

      _logger.mlog.debug('Modem Initialization failed');

      throw new Error('Modem Initialization failed');
    } 
  });

  return function init() {
    return _ref2.apply(this, arguments);
  };
}();

exports.init = init;
//# sourceMappingURL=modem.js.map
