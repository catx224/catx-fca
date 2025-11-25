<div align="center">

![20241210_183831](https://files.catbox.moe/4rl0za.webp)

<h2 align="center"><b>Unoffcial Facebook Chat API</b></h2><br>This package is created by <b>DongDev</b> And Modified By <b>Mueid Mursalin Rifat</b>

![Image](https://files.catbox.moe/8urnyq.png)


Facebook now has an official API for chat bots [here](https://developers.facebook.com/docs/messenger-platform).

This API is the only way to automate chat functionalities on a user account. We do this by emulating the browser. This means doing the exact same GET/POST requests and tricking Facebook into thinking we're accessing the website normally. Because we're doing it this way, this API won't work with an auth token but requires the credentials of a Facebook account.

MODIFIED BY MUEID MURSALIN RIFAT 

## Install

If you just want to use @shadow/catx-fca, you should use this command:

```bash
npm install @shadow/catx-fca@latest
```

It will download @shadow/catx-fca from NPM repositories

## Example Usage

```javascript

const login = require("@shadow/catx-fca");

login({ appState: [] }, (err, api) => {
    if (err) return console.error(err);

    api.listenMqtt((err, event) => {
        if (err) return console.error(err);

        api.sendMessage(event.body, event.threadID);
    });
});

```

Result:

<img width="517" alt="screen shot 2016-11-04 at 14 36 00" src="https://cloud.githubusercontent.com/assets/4534692/20023545/f8c24130-a29d-11e6-9ef7-47568bdbc1f2.png">

## Main Functionality

### Sending a message

#### api.sendMessage(message, threadID[, callback][, messageID])

Various types of message can be sent:

* *Regular:* set field `body` to the desired message as a string.
* *Sticker:* set a field `sticker` to the desired sticker ID.
* *File or image:* Set field `attachment` to a readable stream or an array of readable streams.
* *URL:* set a field `url` to the desired URL.
* *Emoji:* set field `emoji` to the desired emoji as a string and set field `emojiSize` with size of the emoji (`small`, `medium`, `large`)

Note that a message can only be a regular message (which can be empty) and optionally one of the following: a sticker, an attachment or a url.

__Tip__: to find your own ID, you can look inside the cookies. The `userID` is under the name `c_user`.

__Example (Basic Message)__

```js
const login = require("@shadow/catx-fca");

login({ appState: [] }, (err, api) => {
    if (err) {
        console.error("Login Error:", err);
        return;
    }

    let yourID = "000000000000000"; // Replace with actual Facebook ID
    let msg = "Hey!";
  
    api.sendMessage(msg, yourID, (err) => {
        if (err) console.error("Message Sending Error:", err);
        else console.log("Message sent successfully!");
    });
});

```

__Example (File upload)__

```js
const login = require("@shadow/catx-fca");
const fs = require("fs"); // ✅ Required the fs module

login({ appState: [] }, (err, api) => {
    if (err) {
        console.error("Login Error:", err);
        return;
    }

    let yourID = "000000000000000"; // Replace with actual Facebook ID
    let imagePath = __dirname + "/image.jpg";

    // Check if the file exists before sending
    if (!fs.existsSync(imagePath)) {
        console.error("Error: Image file not found!");
        return;
    }

    let msg = {
        body: "Hey!",
        attachment: fs.createReadStream(imagePath)
    };

    api.sendMessage(msg, yourID, (err) => {
        if (err) console.error("Message Sending Error:", err);
        else console.log("Message sent successfully!");
    });
});

```

---
##email pass login method(new added)

// Traditional appState login (still works)
```js
const login = require('./index');

login({ appState: JSON.parse(fs.readFileSync('appstate.json')) }, (err, api) => {
  if (err) return console.error(err);
  // Use api...
});

// New email/password login with Graph API
login({ email: 'your_email', password: 'your_password' }, (err, api) => {
  if (err && err.type === 'login-approval') {
    // Handle 2FA
    console.log('Enter 2FA code:');
    // Get code from user input, then:
    err.continue('123456');
    return;
  } else if (err) {
    console.error(err);
    return;
  }
  // Use api...
});

```
### Saving session.

To avoid logging in every time you should save AppState (cookies etc.) to a file, then you can use it without having password in your scripts.

__Example__

```js
const fs = require("fs");
const login = require("@shadow/catx-fca");

const credentials = { appState: [] };

login(credentials, (err, api) => {
    if (err) {
        console.error("Login Error:", err);
        return;
    }

    try {
        const appState = JSON.stringify(api.getAppState(), null, 2); // Pretty print for readability
        fs.writeFileSync("appstate.json", appState);
        console.log("✅ AppState saved successfully!");
    } catch (error) {
        console.error("Error saving AppState:", error);
    }
});

```

Alternative: Use [c3c-fbstate](https://github.com/c3cbot/c3c-fbstate) to get fbstate.json (appstate.json)

---

### Listening to a chat

#### api.listenMqtt(callback)

Listen watches for messages sent in a chat. By default this won't receive events (joining/leaving a chat, title change etc…) but it can be activated with `api.setOptions({listenEvents: true})`. This will by default ignore messages sent by the current account, you can enable listening to your own messages with `api.setOptions({selfListen: true})`.

__Example__

```js
const fs = require("fs");
const login = require("@shadow/catx-fca");

// Simple echo bot: Repeats everything you say. Stops when you say "/stop".
login({ appState: JSON.parse(fs.readFileSync("appstate.json", "utf8")) }, (err, api) => {
    if (err) {
        console.error("Login Error:", err);
        return;
    }

    api.setOptions({ listenEvents: true });

    const stopListening = api.listenMqtt((err, event) => {
        if (err) {
            console.error("Listen Error:", err);
            return;
        }

        // Mark message as read
        api.markAsRead(event.threadID, (err) => {
            if (err) console.error("Mark as read error:", err);
        });

        // Handle different event types
        switch (event.type) {
            case "message":
                if (event.body && event.body.trim().toLowerCase() === "/stop") {
                    api.sendMessage("Goodbye…", event.threadID);
                    stopListening();
                    return;
                }
                api.sendMessage(`TEST BOT: ${event.body}`, event.threadID);
                break;

            case "event":
                console.log("Event Received:", event);
                break;
        }
    });
});

```

`<a name="projects-using-this-api"></a>`
