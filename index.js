"use strict";
const utils = require("./utils");
const log = require("npmlog");
const { execSync, exec } = require('child_process');
const { promises: fsPromises, readFileSync } = require('fs');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const models = require("./lib/database/models");
const logger = require("./lib/logger");
const { v4: uuidv4 } = require('uuid');

let checkVerified = null;
const defaultLogRecordSize = 100;
log.maxRecordSize = defaultLogRecordSize;

const defaultConfig = {
  autoUpdate: true,
  mqtt: {
    enabled: true,
    reconnectInterval: 3600,
  }
};

const configPath = path.join(process.cwd(), "fca-config.json");
let config;

if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  config = defaultConfig;
} else {
  try {
    const fileContent = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(fileContent);
    config = { ...defaultConfig, ...config };
  } catch (err) {
    logger("Error reading config file, using defaults", "error");
    config = defaultConfig;
  }
}

global.fca = {
  config: config
};

const Boolean_Option = [
  "online",
  "selfListen",
  "listenEvents",
  "updatePresence",
  "forceLogin",
  "autoMarkDelivery",
  "autoMarkRead",
  "listenTyping",
  "autoReconnect",
  "emitReady",
];

function setOptions(globalOptions, options) {
  Object.keys(options).map(function (key) {
    switch (Boolean_Option.includes(key)) {
      case true: {
        globalOptions[key] = Boolean(options[key]);
        break;
      }
      case false: {
        switch (key) {
          case "pauseLog": {
            if (options.pauseLog) log.pause();
            else log.resume();
            break;
          }
          case "logLevel": {
            log.level = options.logLevel;
            globalOptions.logLevel = options.logLevel;
            break;
          }
          case "logRecordSize": {
            log.maxRecordSize = options.logRecordSize;
            globalOptions.logRecordSize = options.logRecordSize;
            break;
          }
          case "pageID": {
            globalOptions.pageID = options.pageID.toString();
            break;
          }
          case "userAgent": {
            globalOptions.userAgent =
              options.userAgent ||
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
            break;
          }
          case "proxy": {
            if (typeof options.proxy != "string") {
              delete globalOptions.proxy;
              utils.setProxy();
            } else {
              globalOptions.proxy = options.proxy;
              utils.setProxy(globalOptions.proxy);
            }
            break;
          }
          default: {
            log.warn(
              "setOptions",
              "Unrecognized option given to setOptions: " + key
            );
            break;
          }
        }
        break;
      }
    }
  });
}

function buildAPI(globalOptions, html, jar) {
  const cookies = jar.getCookies("https://www.facebook.com");
  const userCookie = cookies.find(c => c.cookieString().startsWith("c_user="));
  const tiktikCookie = cookies.find(c => c.cookieString().startsWith("i_user="));
  
  if (!userCookie && !tiktikCookie) {
    return log.error('login', "Không tìm thấy cookie cho người dùng, vui lòng kiểm tra lại thông tin đăng nhập");
  } else if (html.includes("/checkpoint/block/?next")) {
    return log.error('login', "Appstate die, vui lòng thay cái mới!", 'error');
  }

  const userID = (tiktikCookie || userCookie).cookieString().split("=")[1];
  const i_userID = tiktikCookie ? tiktikCookie.cookieString().split("=")[1] : null;
  logger(`Logged in as ${userID}`, 'info');

  try {
    clearInterval(checkVerified);
  } catch (_) { }

  const clientID = ((Math.random() * 2147483648) | 0).toString(16);
  let mqttEndpoint, region, fb_dtsg, irisSeqID;

  try {
    const endpointMatch = html.match(/"endpoint":"([^"]+)"/);
    if (endpointMatch) {
      mqttEndpoint = endpointMatch[1].replace(/\\\//g, "/");
      const url = new URL(mqttEndpoint);
      region = url.searchParams.get("region")?.toUpperCase() || "PRN";
    }
    logger(`Sever region ${region}`, 'info');
  } catch (e) {
    log.warning("login", "Not MQTT endpoint");
  }

  const tokenMatch = html.match(/DTSGInitialData.*?token":"(.*?)"/);
  if (tokenMatch) {
    fb_dtsg = tokenMatch[1];
  }

  (async () => {
    try {
      await models.sequelize.authenticate();
      await models.syncAll();
    } catch (error) {
      console.error(error);
      console.error('Database connection failed:', error.message);
    }
  })();

  logger(`FCA modified by Mueid Mursalin Rifat`, 'info');

  const ctx = {
    userID: userID,
    i_userID: i_userID,
    jar: jar,
    clientID: clientID,
    globalOptions: globalOptions,
    loggedIn: true,
    access_token: "NONE",
    clientMutationId: 0,
    mqttClient: undefined,
    lastSeqId: irisSeqID,
    syncToken: undefined,
    mqttEndpoint,
    region,
    firstListen: true,
    fb_dtsg,
    wsReqNumber: 0,
    wsTaskNumber: 0
  };

  const api = {
    setOptions: setOptions.bind(null, globalOptions),
    getAppState: function getAppState() {
      const appState = utils.getAppState(jar);
      return appState.filter(
        (item, index, self) =>
          self.findIndex((t) => {
            return t.key === item.key;
          }) === index
      );
    },
  };

  const defaultFuncs = utils.makeDefaults(html, i_userID || userID, ctx);

  require("fs")
    .readdirSync(__dirname + "/src/")
    .filter((v) => v.endsWith(".js"))
    .map(function (v) {
      api[v.replace(".js", "")] = require("./src/" + v)(defaultFuncs, api, ctx);
    });

  api.listen = api.listenMqtt;

  setInterval(async () => {
    api
      .refreshFb_dtsg()
      .then(() => {
        logger("Successfully refreshed fb_dtsg", 'info');
      })
      .catch((err) => {
        console.error("An error occurred while refreshing fb_dtsg", err);
      });
  }, 1000 * 60 * 60 * 24);

  return {
    ctx,
    defaultFuncs,
    api
  };
}

async function graphLogin(email, password, jar, globalOptions, callback) {
  try {
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "Host": "graph.facebook.com",
      "User-Agent": "[FBAN/FB4A;FBAV/286.0.0.48.112;FBBV/242171849;FBDM/{density=2.75,width=1080,height=2131};FBLC/pt_BR;FBRV/0;FBCR/VIVO;FBMF/Xiaomi;FBBD/xiaomi;FBPN/com.facebook.katana;FBDV/Redmi Note 7;FBSV/10;FBOP/1;FBCA/arm64-v8a:;]",
      "X-FB-Net-HNI": "45204",
      "X-FB-SIM-HNI": "45201",
      "Authorization": "OAuth 350685531728|62f8ce9f74b12f84c123cc23437a4a32",
      "X-FB-Connection-Type": "WIFI",
      "X-Tigon-Is-Retry": "False",
      "x-fb-session-id": "nid=jiZ+yNNBgbwC;pid=Main;tid=132;nc=1;fc=0;bc=0;cid=62f8ce9f74b12f84c123cc23437a4a32",
      "x-fb-device-group": "5120",
      "X-FB-Friendly-Name": "ViewerReactionsMutation",
      "X-FB-Request-Analytics-Tags": "graphservice",
      "Accept-Encoding": "gzip, deflate",
      "X-FB-HTTP-Engine": "Liger",
      "X-FB-Client-IP": "True",
      "X-FB-Server-Cluster": "True",
      "x-fb-connection-token": "62f8ce9f74b12f84c123cc23437a4a32",
      "Connection": "Keep-Alive",
    };

    const data = {
      "adid": uuidv4(),
      "format": "json",
      "device_id": uuidv4(),
      "cpl": "true",
      "family_device_id": uuidv4(),
      "credentials_type": "device_based_login_password",
      "error_detail_type": "button_with_disabled",
      "source": "device_based_login",
      "email": email,
      "password": password,
      "access_token": "350685531728|62f8ce9f74b12f84c123cc23437a4a32",
      "generate_session_cookies": "1",
      "meta_inf_fbmeta": "",
      "advertiser_id": uuidv4(),
      "currently_logged_in_userid": "0",
      "locale": "en_US",
      "client_country_code": "US",
      "method": "auth.login",
      "fb_api_req_friendly_name": "authenticate",
      "fb_api_caller_class": "com.facebook.account.login.protocol.Fb4aAuthHandler",
      "api_key": "62f8ce9f74b12f84c123cc23437a4a32",
    };

    const response = await axios.post(
      'https://graph.facebook.com/auth/login',
      new URLSearchParams(data),
      {
        headers: headers,
        maxRedirects: 0,
        validateStatus: function (status) {
          return status >= 200 && status < 400;
        }
      }
    );

    const result = response.data;

    if (result.error) {
      const error = new Error(result.error.message);
      error.code = result.error.code;
      
      if (result.error.code === 401) {
        error.type = 'login-approval';
        error.continue = (code) => handleTwoFactor(data, code, jar, globalOptions, callback);
      }
      
      throw error;
    }

    // Save cookies from successful login
    if (result.session_cookies) {
      result.session_cookies.forEach(cookie => {
        const cookieStr = `${cookie.name}=${cookie.value}; domain=${cookie.domain || '.facebook.com'}; path=${cookie.path || '/'}`;
        jar.setCookie(cookieStr, "https://www.facebook.com");
      });
    }

    return result;
  } catch (error) {
    throw error;
  }
}

async function handleTwoFactor(originalData, code, jar, globalOptions, callback) {
  try {
    const dataWith2FA = {
      ...originalData,
      twofactor_code: code.toString()
    };

    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "Host": "graph.facebook.com",
      "User-Agent": "[FBAN/FB4A;FBAV/286.0.0.48.112;FBBV/242171849;FBDM/{density=2.75,width=1080,height=2131};FBLC/pt_BR;FBRV/0;FBCR/VIVO;FBMF/Xiaomi;FBBD/xiaomi;FBPN/com.facebook.katana;FBDV/Redmi Note 7;FBSV/10;FBOP/1;FBCA/arm64-v8a:;]",
      "Authorization": "OAuth 350685531728|62f8ce9f74b12f84c123cc23437a4a32",
      "X-FB-Connection-Type": "WIFI",
      "Accept-Encoding": "gzip, deflate",
      "Connection": "Keep-Alive",
    };

    const response = await axios.post(
      'https://graph.facebook.com/auth/login',
      new URLSearchParams(dataWith2FA),
      {
        headers: headers,
        maxRedirects: 0,
        validateStatus: function (status) {
          return status >= 200 && status < 400;
        }
      }
    );

    const result = response.data;

    if (result.error) {
      throw new Error(result.error.message);
    }

    // Save cookies from successful 2FA login
    if (result.session_cookies) {
      result.session_cookies.forEach(cookie => {
        const cookieStr = `${cookie.name}=${cookie.value}; domain=${cookie.domain || '.facebook.com'}; path=${cookie.path || '/'}`;
        jar.setCookie(cookieStr, "https://www.facebook.com");
      });
    }

    return result;
  } catch (error) {
    throw error;
  }
}

function loginHelper(appState, email, password, globalOptions, callback, prCallback) {
  let mainPromise = null;
  const jar = utils.getJar();

  if (appState) {
    try {
      appState = JSON.parse(appState);
    } catch (e) {
      try {
        appState = appState;
      } catch (e) {
        return callback(new Error("Failed to parse appState"));
      }
    }

    try {
      appState.forEach(c => {
        const str = `${c.key}=${c.value}; expires=${c.expires}; domain=${c.domain}; path=${c.path};`;
        jar.setCookie(str, "http://" + c.domain);
      });

      mainPromise = utils.get('https://www.facebook.com/', jar, null, globalOptions, { noRef: true })
        .then(utils.saveCookies(jar));
    } catch (e) {
      process.exit(0);
    }
  } else {
    // Use the new Graph API login
    mainPromise = graphLogin(email, password, jar, globalOptions, callback)
      .then(loginData => {
        // After successful Graph API login, get the main page to establish session
        return utils.get('https://www.facebook.com/', jar, null, globalOptions)
          .then(utils.saveCookies(jar))
          .then(res => ({ res, loginData }));
      })
      .catch(error => {
        if (error.type === 'login-approval' && prCallback) {
          // Handle 2FA
          const continueWith2FA = (code) => {
            handleTwoFactor(error.originalData, code, jar, globalOptions, callback)
              .then(loginData => {
                return utils.get('https://www.facebook.com/', jar, null, globalOptions)
                  .then(utils.saveCookies(jar))
                  .then(res => ({ res, loginData }));
              })
              .then(data => processLoginSuccess(data, jar, globalOptions, callback))
              .catch(err => callback(err));
          };
          
          error.continue = continueWith2FA;
          callback(error);
          return Promise.reject(error);
        } else {
          callback(error);
          return Promise.reject(error);
        }
      });
  }

  function processLoginSuccess(data, jar, globalOptions, callback) {
    const { res, loginData } = data;
    
    function handleRedirect(res) {
      const reg = /<meta http-equiv="refresh" content="0;url=([^"]+)[^>]+>/;
      const redirect = reg.exec(res.body);
      if (redirect && redirect[1]) {
        return utils.get(redirect[1], jar, null, globalOptions).then(utils.saveCookies(jar));
      }
      return res;
    }

    let ctx, api;
    
    return Promise.resolve(res)
      .then(handleRedirect)
      .then(res => {
        const mobileAgentRegex = /MPageLoadClientMetrics/gs;
        if (!mobileAgentRegex.test(res.body)) {
          globalOptions.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
          return utils.get('https://www.facebook.com/', jar, null, globalOptions, { noRef: true }).then(utils.saveCookies(jar));
        }
        return res;
      })
      .then(handleRedirect)
      .then(res => {
        const html = res.body;
        const Obj = buildAPI(globalOptions, html, jar);
        ctx = Obj.ctx;
        api = Obj.api;
        return { res, api, loginData };
      })
      .then(data => {
        logger('Login successful!', '[ FCA-UNO ] >');
        callback(null, data.api);
        return data;
      });
  }

  if (appState) {
    // Original flow for appState login
    mainPromise
      .then(handleRedirect)
      .then(res => {
        const mobileAgentRegex = /MPageLoadClientMetrics/gs;
        if (!mobileAgentRegex.test(res.body)) {
          globalOptions.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
          return utils.get('https://www.facebook.com/', jar, null, globalOptions, { noRef: true }).then(utils.saveCookies(jar));
        }
        return res;
      })
      .then(handleRedirect)
      .then(res => {
        const html = res.body;
        const Obj = buildAPI(globalOptions, html, jar);
        const ctx = Obj.ctx;
        const api = Obj.api;
        return { res, api };
      })
      .then(data => {
        logger('Login successful!', '[ FCA-UNO ] >');
        callback(null, data.api);
      })
      .catch(e => {
        callback(e);
      });
  } else {
    // New flow for Graph API login
    mainPromise
      .then(data => processLoginSuccess(data, jar, globalOptions, callback))
      .catch(e => {
        if (e.type !== 'login-approval') {
          callback(e);
        }
      });
  }

  function handleRedirect(res) {
    const reg = /<meta http-equiv="refresh" content="0;url=([^"]+)[^>]+>/;
    const redirect = reg.exec(res.body);
    if (redirect && redirect[1]) {
      return utils.get(redirect[1], jar, null, globalOptions).then(utils.saveCookies(jar));
    }
    return res;
  }
}

function login(loginData, options, callback) {
  if (
    utils.getType(options) === "Function" ||
    utils.getType(options) === "AsyncFunction"
  ) {
    callback = options;
    options = {};
  }

  const globalOptions = {
    selfListen: false,
    selfListenEvent: false,
    listenEvents: false,
    listenTyping: false,
    updatePresence: false,
    forceLogin: false,
    autoMarkDelivery: true,
    autoMarkRead: false,
    autoReconnect: true,
    logRecordSize: defaultLogRecordSize,
    online: true,
    emitReady: false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  };

  setOptions(globalOptions, options);

  let prCallback = null;
  if (
    utils.getType(callback) !== "Function" &&
    utils.getType(callback) !== "AsyncFunction"
  ) {
    let rejectFunc = null;
    let resolveFunc = null;
    var returnPromise = new Promise(function (resolve, reject) {
      resolveFunc = resolve;
      rejectFunc = reject;
    });
    prCallback = function (error, api) {
      if (error) {
        return rejectFunc(error);
      }
      return resolveFunc(api);
    };
    callback = prCallback;
  }

  loginHelper(
    loginData.appState,
    loginData.email,
    loginData.password,
    globalOptions,
    callback,
    prCallback
  );

  return returnPromise;
}

// Export thread colors
module.exports.threadColors = {
  DefaultBlue: '196241301102133',
  HotPink: '169463077092846',
  AquaBlue: '2442142322678320',
  BrightPurple: '234137870477637',
  CoralPink: '980963458735625',
  Orange: '175615189761153',
  Green: '2136751179887052',
  LavenderPurple: '2058653964378557',
  Red: '2129984390566328',
  Yellow: '174636906462322',
  TealBlue: '1928399724138152',
  Aqua: '417639218648241',
  Mango: '930060997172551',
  Berry: '164535220883264',
  Citrus: '370940413392601',
  Candy: '205488546921017'
};

module.exports = login;
