> [!WARNING]
> This project is a huge work in progress, please understand there will be bugs! <br>

<img width="192" alt="PolyMSNP logo" src="https://raw.githubusercontent.com/dskooper/PolyMSNP/refs/heads/main/logo.png" /> <br>

PolyMSNP is a lightweight web-based client for the MSNP instant messaging protocol!

This repository contains the Rust-based source code for the server.

#### Hiatus, kinda?
Before you make any assumptions, **PolyMSNP isn't being archived or cancelled!** <br>
At the moment I am currently going through a mental slump, so I'm not really motivated to constantly work on it. <br>
This does mean no updates for a while, but I promise that I won't abandon PolyMSNP.

## Servers
> [!NOTE]
> If you are hosting your own instance of PolyMSNP, please let me know!

As of right now, there are **2** websites hosting this server:
- http://pmsnp.kooper.online | https://pmsnp.kooper.online (not 24/7, only for testing)
  - If you get an error (e.g. 1033) when trying to access, 99% chance it is down!
- https://msn.rawrr.dev (24/7, updates weekly per cronjob)

Even so, it is highly recommended to host PolyMSNP yourself!

## Compatibility
The legacy UI requires at least Internet Explorer 9 to function correctly.

The modern UI has not been extensively tested, however any modern browser should just work.

### JavaScript/ECMAScript
Currently, the main JS script used to communicate between the device and the server is compliant with ECMAScript 3. <br>
This means support for some browsers from 1999/2000 onwards (Firefox 1, Chrome 1, Safari 1). <br>

The following browsers are confirmed not working:
- Internet Explorer 8 and earlier (support will come soon!)
- Opera Mini (will probably never work)

The following browsers have not been tested, please try them out and let me know:
- Opera (Mobile)
- Netscape Navigator
- Safari 1
- Chrome 1
- Firefox 1

## Features
- Specify your own (or use predefined) MSNP11-compatible third-party servers
- Send and receive messages, nudges, and emoticons.[^1]
- Add and remove contacts from your contact list
- View and change your own username, personal message and status (online, offline/invisible, away, etc.)
- View contact's status and personal message

## Todo
Next build:
- [ ] Dark mode support for the generic UI

Next release:
- [ ] View profile pictures
- [ ] Proper versioning system **that's implemented into the program**
  - [ ] Have PolyMSNP display a build version and complain if its not the latest

***Maybe***:
- [ ] Sending images (this is gonna be a pain to implement but hopefully it'll be worth it)

### Current list of "wontfix" features
- Winks (requires Adobe Flash which is discontinued) <br>
  - Desktop users can still view Flash content via Ruffle or Clean Flash Player
- **File** transfers (not sure how to implement, also this is not meant to be a feature-complete client):
  - As a workaround you can use something like [Litterbox](https://litterbox.catbox.moe) instead.
- Voice/video calling (No clue how to implement this and also this probably wouldn't work on mobile devices)

## Contributions
Anyone is welcome to contribute to PolyMSNP! All you need to do is:
- Fork the repository
- Make your changes
- Submit a pull request
Make sure to read [CONTRIBUTING.md](CONTRIBUTING.md) first!

## Building
### Prerequisites
- The Rust programming language, downloadable from [here](https://rust-lang.org/tools/install/).
  - By association, any operating system that is still supported by Rust.

Once installed, you can do the following:
- Linux and macOS:
  ```
  git clone https://github.com/dskooper/PolyMSNP
  cd PolyMSNP
  chmod +x build-release.sh && ./build-release.sh
  ```
- Windows:
  1. Download the entire repository by clicking on [this link](https://github.com/dskooper/PolyMSNP/archive/refs/heads/main.zip)
  2. Extract the repository into a folder and enter it.
  3. Right click on `build-release.ps1` and press on "Run with PowerShell`

If successful, there should now be a `build-rel` folder containing an executable.

## Usage
Once compiled, you can launch the server executable to immediately start hosting on 0.0.0.0 port 7659[^2].

### Adding new emoticon packs

To create a new emoticon pack for PolyMSNP, do the following:
1. Inside your PolyMSNP executable's folder, navigate to `static/emoticons`
2. Inside `packs.json`, insert a new entry:
   ```
   [
     ...,
     {
       "id": "example",
       "name": "Example Name",
       "description": "A short sentence meant to summarise the emoticons used."
     }
   ]
   ```
3. Create a new folder with the same name as the pack ID (e.g. "example")
4. Inside that folder, place all of your raw emoticon images (ideally transparent) and create a new file called `<Pack ID>.json`. Replace `<Pack ID>` with your pack's ID (e.g. "example")
5. Inside the new JSON file, create a reference to all of your emoticons:
   ```
   {
     "emoticons": {
       ":)": "happy.png",
       ":(": "sad.png",
       ">:(": "angry.png",
       ...
     }
   }
   ```

## Credits/Thanks
- [campos02](https://github.com/campos02) for creating the [MSNP11 SDK](https://github.com/campos02/msnp11-sdk) which this project uses
- [CrossTalk](https://crosstalk.im) for a great MSN Messenger revival.

## License
<img width="136" height="68" alt="gplv3-with-text-136x68" src="https://github.com/user-attachments/assets/9f55f108-02c2-46db-bf0f-84949be260ae" />

This project is open-source and provided under the GNU GPL v3 license: you can view the license contents [here](https://www.gnu.org/licenses/gpl-3.0.txt)

[^1]: For legal reasons, PolyMSNP does not use the official MSN Messenger emoticons by default. You must provide them yourself.
[^2]: Make sure that this port is not blocked by your firewall or in use by another process.
