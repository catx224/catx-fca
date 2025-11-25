"use strict";

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

/**
 * Graph API Login Function
 */
async function graphLogin(email, password, jar, globalOptions) {
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

/**
 * Handle Two-Factor Authentication
 */
async function handleTwoFactor(originalData, code, jar) {
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

module.exports = {
    graphLogin,
    handleTwoFactor
};