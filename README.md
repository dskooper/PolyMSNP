# iMSNP
iMSNP is a lightweight web-based client for the MSNP instant messaging protocol!

This repository contains the Rust-based source code for the server.

## Servers
> [!NOTE]
> If you are hosting your own instance of iMSNP, please let me know!

As of right now, there is **1** website hosting this server:
- https://imsnp.kooper.online (not 24/7, only for testing)

Even so, it is highly recommended to host iMSNP yourself!

## Compatibility
This client is designed to work flawlessly on iOS 6's Safari/WebKit, with iOS 5 support coming soon...

Any browser from then on should run iMSNP fine.

### Unsupported browsers
iMSNP was designed for legacy WebKit in mind, and therefore some browsers may not cooperate:
- Opera Mini (untested)
- Internet Explorer (untested)

Issues will be closed as "wontfix" as its out of scope (this project was never made to support anything other than mobile browsers anyway).

## Features (besides core functionality)
- Specify your own MSNP11-compatible server on login
- Send and receive nudges
- Make additions to your contact list
- View contact's status (online, offline, away, etc.) and change your own
- View contact's personal message
- Change your own personal message

## Todo (in descending order of priority)
- [ ] Proper versioning system (currently half-implemented)
- [x] Replace web app icon with something original (https://github.com/dskooper/imsnp/issues/1)
- [ ] See your current username and personal message
  - [ ] Change your username
- [ ] Allow users to remove contacts
- [ ] View profile pictures
- [ ] Dark mode

### List of "wontfix" features
- Winks:
  - Requires Adobe Flash which was never available on iOS[^1] and dropped from Android after Ice Cream Sandwich. <br>
- File transfers:
  - Personally out of scope, iMSNP is not supposed to be a feature-complete client (and also idk how to implement). <br>
    If you want to transfer files use something like [Litterbox](https://litterbox.catbox.moe)
- Voice/video calling:
  - Very out of scope considering it probably wouldn't work on mobile devices (assuming I knew how to implement that in the first place)
- MSN emoticons:
  - This would likely get me in legal trouble with Microsoft. All mobile devices basically come with emoji pickers anyway so just use those
- Custom emoticons:
  - Not implemented by the MSNP11 SDK yet, either way MSN emoticons won't be added so why this?

## Building
### Prerequisites
- The Rust programming language, downloadable from [here](https://rust-lang.org/tools/install/).
  - By association, any operating system that is still supported by Rust.

Once installed, you can do the following:
- Linux:
  ```
  git clone https://github.com/dskooper/imsnp
  cd imsnp
  ./build-release.sh
  ```
- Windows:
  1. Download the entire repository by clicking on [this link](https://github.com/dskooper/imsnp/archive/refs/heads/main.zip)
  2. Extract the repository into a folder and enter it.
  3. Right click on `build-release.ps1` and press on "Run with PowerShell`

If successful, there should now be a `build-rel` folder containing an executable.

## Usage
Once compiled, you can launch the server executable to immediately start hosting on 0.0.0.0 port 27677[^2]. <br>

## Credits/Thanks
- [campos02](https://github.com/campos02) for creating the [MSNP11 SDK](https://github.com/campos02/msnp11-sdk) which this project uses
- [CrossTalk](https://crosstalk.im) for providing a compatible MSNP server that I used to test

## License
<img width="136" height="68" alt="gplv3-with-text-136x68" src="https://github.com/user-attachments/assets/9f55f108-02c2-46db-bf0f-84949be260ae" />

This project is open-source and provided under the GNU GPL v3 license: you can view the license contents [here](https://www.gnu.org/licenses/gpl-3.0.txt)

[^1]: Outside of apps such as Puffin Browser, which are no longer in development.
[^2]: Make sure that this port is not blocked by your firewall or in use by another process.
