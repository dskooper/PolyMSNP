(function() {
    // functions for compatibility with old browsers
    function trim(str) {
        return str.replace(/^\s+|\s+$/g, '');
    }
    
    function isArray(obj) {
        return Object.prototype.toString.call(obj) === '[object Array]';
    }

    function on(target, eventName, handler) {
        if (!target) {
            return;
        }

        if (target.addEventListener) {
            target.addEventListener(eventName, handler, false);
            return;
        }

        if (target.attachEvent) {
            target.attachEvent('on' + eventName, function() {
                var event = window.event || {};
                if (!event.target) {
                    event.target = event.srcElement || target;
                }
                if (!event.preventDefault) {
                    event.preventDefault = function() {
                        event.returnValue = false;
                    };
                }
                if (!event.stopPropagation) {
                    event.stopPropagation = function() {
                        event.cancelBubble = true;
                    };
                }
                return handler.call(target, event);
            });
        }
    }

    function hasClassName(element, className) {
        if (!element || !element.className) {
            return false;
        }

        return (' ' + element.className + ' ').indexOf(' ' + className + ' ') !== -1;
    }

    function findFirstByClass(root, className) {
        var elements;
        var index;

        if (!root) {
            return null;
        }

        if (hasClassName(root, className)) {
            return root;
        }

        elements = root.getElementsByTagName('*');
        for (index = 0; index < elements.length; index++) {
            if (hasClassName(elements[index], className)) {
                return elements[index];
            }
        }

        return null;
    }

    // polyfill json.stringify and json.parse
    if (typeof window.JSON === 'undefined') {
        window.JSON = {};
    }
    if (typeof window.JSON.stringify !== 'function') {
        window.JSON.stringify = function(obj) {
            if (obj === null) return 'null';
            var type = typeof obj;
            if (type === 'string') return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
            if (type === 'number') return (isFinite(obj) ? String(obj) : 'null');
            if (type === 'boolean') return String(obj);
            if (type === 'undefined') return undefined;
            if (type === 'object') {
                if (obj === null) return 'null';
                if (isArray(obj)) {
                    var arr = [];
                    for (var i = 0; i < obj.length; i++) {
                        var elem = window.JSON.stringify(obj[i]);
                        arr.push(typeof elem === 'undefined' ? 'null' : elem);
                    }
                    return '[' + arr.join(',') + ']';
                } else {
                    var props = [];
                    for (var key in obj) {
                        if (obj.hasOwnProperty(key)) {
                            var val = window.JSON.stringify(obj[key]);
                            if (typeof val !== 'undefined') {
                                props.push(window.JSON.stringify(key) + ':' + val);
                            }
                        }
                    }
                    return '{' + props.join(',') + '}';
                }
            }
            return undefined;
        };
    }
    if (typeof window.JSON.parse !== 'function') {
        window.JSON.parse = (function() {
            var cx = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u2029\u2060-\u206f\ufeff\ufff0-\uffff]/g;
            var escapable = /[\\"\x00-\x1f\x7f-\x9f]/g;
            var meta = {'\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\'};
            function quote(string) {
                escapable.lastIndex = 0;
                return escapable.test(string) ? '"' + string.replace(escapable, function(a) {
                    return meta[a] || '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
                }) + '"' : '"' + string + '"';
            }
            return function(text) {
                if (typeof text !== 'string') return text;
                cx.lastIndex = 0;
                if (cx.test(text)) {
                    text = text.replace(cx, function(a) {
                        return '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
                    });
                }
                if (/^[\],:{}\s]*$/.test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@').replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']').replace(/(?:^|:|,)(?:\s*\[)+/g, ''))) {
                    return eval('(' + text + ')');
                }
                throw new SyntaxError('JSON.parse');
            };
        }());
    }
    
    var ws = null;
    var currentContact = null;
    var contacts = {};
    var suppressAutoOpenChats = false;
    var conversations = {};
    var conversationStates = {};
    var queuedMessages = {};
    var typingTimers = {};
    var conversationUnreadCounts = {};
    var contactActivityState = {};
    var ownProfile = {
        email: '',
        displayName: '',
        personalMessage: ''
    };
    var contactEditMode = false;
    var selectedContactsForRemoval = {};
    var contactRefreshTimer = null;
    var isRedirecting = false;
    var loginAttemptActive = false;
    var pendingLoginMessage = null;
    var websocketUrls = [];
    var websocketAttemptIndex = 0;
    var websocketOpened = false;
    var websocketRetryTimer = null;
    var pollingActive = false;
    var pollingCursor = 0;
    var pollingTimer = null;
    var forceHttpEnabled = false;
    var userAgent = window.navigator && window.navigator.userAgent ? window.navigator.userAgent : '';
    var loginRedirectOverride = null;

    var configuredServices = {
        crosstalk: {
            server: 'ms.msgrsvcs.ctsrv.gay',
            port: 1863,
            nexus: 'pp.login.ugnet.gay',
            config: 'config.login.ugnet.gay'
        },
        crosstalk_nodispatch: {
            server: 'ms.msgrsvcs.ctsrv.gay',
            port: 1864,
            nexus: 'pp.login.ugnet.gay',
            config: 'config.login.ugnet.gay'
        },
        legacy: {
            server: 'messenger.hotmail.com',
            port: 1863,
            nexus: 'nexus.passport.com',
            config: 'config.messenger.msn.com'
        }
    };

    // functions for browsers that don't support websockets, fall back to long polling
    function supportsWebSocket() {
        return typeof window.WebSocket !== 'undefined';
    }

    function isTransportReady() {
        if (pollingActive) {
            return true;
        }

        return !!(ws && supportsWebSocket() && ws.readyState === window.WebSocket.OPEN);
    }

    function stopPollingTransport() {
        pollingActive = false;
        if (pollingTimer) {
            clearTimeout(pollingTimer);
            pollingTimer = null;
        }
    }

    function connectCurrentTransport() {
        if (supportsWebSocket()) {
            connectWebSocket();
            return;
        }

        connectPollingTransport();
        handleAuthenticated();
    }
    
    // grab references to all the main dom elements we'll need later
    var loginScreen = document.getElementById('loginScreen');
    var mainScreen = document.getElementById('mainScreen');
    var chatScreen = document.getElementById('chatScreen');
    var loginForm = document.getElementById('loginForm');
    var requiredLoginInputs = [];
    if (loginForm) {
        var allInputs = loginForm.getElementsByTagName('input');
        for (var j = 0; j < allInputs.length; j++) {
            if (allInputs[j].getAttribute('required') !== null) {
                requiredLoginInputs.push(allInputs[j]);
            }
        }
    }
    var loginBtn = document.getElementById('loginBtn');
    var serviceSelect = document.getElementById('service');
    var forceHttpToggle = document.getElementById('forceHttp');
    var serverInput = document.getElementById('server');
    var portInput = document.getElementById('port');
    var nexusInput = document.getElementById('nexus');
    var configInput = document.getElementById('config');
    var loginError = document.getElementById('loginError');
    var loginStatus = document.getElementById('loginStatus');
    var statusSelect = document.getElementById('statusSelect');
    var reloadBtn = document.getElementById('reloadBtn');
    var logoutBtn = document.getElementById('logoutBtn');
    var editContactsBtn = document.getElementById('editContactsBtn');
    var removeContactsBtn = document.getElementById('removeContactsBtn');
    var displayNameInput = document.getElementById('displayNameInput');
    var setDisplayNameBtn = document.getElementById('setDisplayNameBtn');
    var currentEmail = document.getElementById('currentEmail');
    var currentDisplayName = document.getElementById('currentDisplayName');
    var currentPersonalMessage = document.getElementById('currentPersonalMessage');
    var personalMessageInput = document.getElementById('personalMessageInput');
    var setPsmBtn = document.getElementById('setPsmBtn');
    var openAddContactBtn = document.getElementById('openAddContactBtn');
    var addContactModal = document.getElementById('addContactModal');
    var addContactInput = document.getElementById('addContactInput');
    var addContactBtn = document.getElementById('addContactBtn');
    var closeAddContactBtn = document.getElementById('closeAddContactBtn');
    var submitAddContactBtn = document.getElementById('submitAddContactBtn');
    var contactList = document.getElementById('contactList');
    var chatTitle = document.getElementById('chatTitle');
    var nudgeBtn = document.getElementById('nudgeBtn');
    var closeChatBtn = document.getElementById('closeChatBtn');
    var messageContainer = document.getElementById('messageContainer');
    var messageInput = document.getElementById('messageInput');
    var emoticonPackSelect = document.getElementById('emoticonPackSelect');
    var customServiceRows = [];
    if (loginForm) {
        var allDivs = loginForm.getElementsByTagName('div');
        for (var k = 0; k < allDivs.length; k++) {
            if (allDivs[k].className && allDivs[k].className.indexOf('custom-service-row') !== -1) {
                customServiceRows.push(allDivs[k]);
            }
        }
    }

    // emoticon storage and metadata
    var emoticonData = null;
    var emoticonCodes = []; // sorted by length (longest first) to prevent partial code matches
    var emoticonBaseUrl = 'emoticons/default/';
    var activeEmoticonPack = 'default';
    var availableEmoticonPacks = []; // array of emoticon pack info from packs.json

    function loadEmoticons(packName) {
        var selectedPack = packName || activeEmoticonPack;
        var jsonPath = '/emoticons/' + selectedPack + '/' + selectedPack + '.json';
        var xhr = new XMLHttpRequest();
        xhr.open('GET', jsonPath, true);
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    emoticonData = JSON.parse(xhr.responseText);
                    if (!emoticonData || !emoticonData.emoticons) {
                        emoticonData = { emoticons: {} };
                    }
                    // pull out all emoticon codes and sort by length so we match longer codes first
                    emoticonCodes = [];
                    for (var code in (emoticonData.emoticons || {})) {
                        if ((emoticonData.emoticons || {}).hasOwnProperty(code)) {
                            emoticonCodes.push(code);
                        }
                    }
                    emoticonCodes.sort(function(a, b) { return b.length - a.length; });
                    activeEmoticonPack = selectedPack;
                    emoticonBaseUrl = '/emoticons/' + activeEmoticonPack + '/';
                    if (emoticonPackSelect) {
                        emoticonPackSelect.value = activeEmoticonPack;
                    }
                    console.log('Emoticons loaded. Count:', emoticonCodes.length);
                } catch (e) {
                    emoticonData = { emoticons: {} };
                    emoticonCodes = [];
                    console.error('Failed to parse emoticon JSON:', e);
                }
            } else {
                emoticonData = { emoticons: {} };
                emoticonCodes = [];
                console.error('Failed to load emoticons:', xhr.status);
            }
        };
        xhr.onerror = function() {
            emoticonData = { emoticons: {} };
            emoticonCodes = [];
            console.error('Error loading emoticons');
        };
        xhr.send();
    }

    function handleEmoticonPackChange() {
        if (!emoticonPackSelect) return;
        var selectedPack = trim((emoticonPackSelect.value || ''));
        if (!selectedPack) return;
        loadEmoticons(selectedPack);
    }

    function loadAvailableEmoticonPacks() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/emoticons/packs.json', true);
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    availableEmoticonPacks = JSON.parse(xhr.responseText);
                    if (!isArray(availableEmoticonPacks)) {
                        availableEmoticonPacks = [];
                    }
                    populateEmoticonPackDropdown();
                    // now that the dropdown is ready, load up the default emoticon pack
                    loadEmoticons('default');
                    console.log('Available emoticon packs:', availableEmoticonPacks.length);
                } catch (e) {
                    console.error('Failed to parse packs.json:', e);
                    // fallbacks: just load default emoticons even if we couldn't list them
                    loadEmoticons('default');
                }
            } else {
                console.error('Failed to load packs.json:', xhr.status);
                loadEmoticons('default');
            }
        };
        xhr.onerror = function() {
            console.error('Error loading packs.json');
            loadEmoticons('default');
        };
        xhr.send();
    }

    function populateEmoticonPackDropdown() {
        if (!emoticonPackSelect) return;
        // clear out any old options from the dropdown
        while (emoticonPackSelect.options.length > 1) {
            emoticonPackSelect.remove(1);
        }
        // remove the initial placeholder option
        emoticonPackSelect.remove(0);
        
        // build the dropdown with all available emoticon packs
        for (var i = 0; i < availableEmoticonPacks.length; i++) {
            var pack = availableEmoticonPacks[i];
            var option = document.createElement('option');
            option.value = pack.id;
            option.textContent = pack.name;
            if (pack.description) {
                option.title = pack.description;
            }
            if (pack.id === 'default') {
                option.selected = true;
            }
            emoticonPackSelect.appendChild(option);
        }
        console.log('Dropdown populated with', availableEmoticonPacks.length, 'packs');
    }

    function parseEmoticons(text) {
        if (!emoticonData || !emoticonCodes || emoticonCodes.length === 0) {
            return text; // emoticons aren't ready yet, just return the text as-is
        }

        var container = document.createElement('span');
        var remaining = text;
        
        while (remaining.length > 0) {
            var matched = false;
            
            // scan through all emoticon codes to see if any match the beginning of what's left
            for (var i = 0; i < emoticonCodes.length; i++) {
                var code = emoticonCodes[i];
                if (remaining.indexOf(code) === 0) {
                    var filename = emoticonData.emoticons[code];
                    
                    // found a match, so create an image element for this emoticon
                    var img = document.createElement('img');
                    img.src = emoticonBaseUrl + filename;
                    img.alt = code;
                    img.width = 32;
                    img.height = 32;
                    img.style.verticalAlign = 'middle';
                    img.style.marginLeft = '2px';
                    img.style.marginRight = '2px';
                    container.appendChild(img);
                    
                    remaining = remaining.substring(code.length);
                    matched = true;
                    break;
                }
            }
            
            if (!matched) {
                // no emoticon matched, so just add this character as regular text
                var char = remaining.charAt(0);
                var textNode = document.createTextNode(char);
                container.appendChild(textNode);
                remaining = remaining.substring(1);
            }
        }
        
        return container;
    }

    function normalizeHostInput(rawValue) {
        var value = trim((rawValue || ''));
        if (!value) return '';

        value = value.replace(/^https?:\/\//i, '');
        value = value.replace(/\/.*$/, '');
        value = value.replace(/\s+/g, '');
        return value;
    }

    function queueContactListRefresh() {
        if (contactRefreshTimer) {
            clearTimeout(contactRefreshTimer);
        }

        contactRefreshTimer = setTimeout(function() {
            updateContactList();
            contactRefreshTimer = null;
        }, 1000);
    }

    function getOwnDisplayNameForTitle() {
        if (ownProfile.displayName && ownProfile.displayName.length) {
            return ownProfile.displayName;
        }
        if (ownProfile.email && ownProfile.email.length) {
            return ownProfile.email;
        }
        return 'User';
    }

    function updateWindowTitle() {
        if (chatScreen && chatScreen.style.display !== 'none' && currentContact) {
            var chatTarget = currentContact;
            if (contacts[currentContact] && contacts[currentContact].displayName) {
                chatTarget = cleanDisplayName(contacts[currentContact].displayName, 32);
            }
            document.title = 'Chatting with ' + chatTarget + ' - PolyMSNP';
            return;
        }

        if (mainScreen && mainScreen.style.display !== 'none') {
            document.title = 'Signed in as ' + getOwnDisplayNameForTitle() + ' - PolyMSNP';
            return;
        }

        document.title = 'PolyMSNP';
    }

    function getChatLayoutMode() {
        if (!document.body) {
            return 'stacked';
        }

        return document.body.getAttribute('data-chat-layout') || 'stacked';
    }

    function setChatSlideOpen(open) {
        if (!document.body) {
            return;
        }

        if (open) {
            addClass(document.body, 'chat-open');
        } else {
            removeClass(document.body, 'chat-open');
        }
    }

    function updateEditControls() {
        // make sure both buttons exist before we try to update them
        if (!editContactsBtn || !removeContactsBtn) return;

        if (!contactEditMode) {
            // not in edit mode, show "Edit" button and hide "Remove" button
            editContactsBtn.textContent = 'Edit';
            removeContactsBtn.style.display = 'none';
            return;
        }

        // in edit mode now - show "Done" button and "Remove" button
        editContactsBtn.textContent = 'Done';
        removeContactsBtn.style.display = 'inline-block';

        // count how many contacts are selected for removal
        var selectedCount = 0;
        for (var email in selectedContactsForRemoval) {
            if (selectedContactsForRemoval.hasOwnProperty(email) && selectedContactsForRemoval[email]) {
                selectedCount++;
            }
        }

        // update the remove button text to show count
        removeContactsBtn.textContent = selectedCount > 0 ? ('Remove (' + selectedCount + ')') : 'Remove';
    }

    function getContactActivityState(email) {
        if (!contactActivityState[email]) {
            contactActivityState[email] = {
                type: '',
                count: 0
            };
        }

        return contactActivityState[email];
    }

    function clearContactActivityState(email) {
        if (contactActivityState[email]) {
            delete contactActivityState[email];
        }

        if (conversationUnreadCounts[email]) {
            delete conversationUnreadCounts[email];
        }
    }

    function markUnreadMessage(email) {
        var state = getContactActivityState(email);
        state.type = 'unread';
        state.count = (conversationUnreadCounts[email] || 0) + 1;
        conversationUnreadCounts[email] = state.count;
        updateContactList();
    }

    function markTypingActivity(email) {
        var state = getContactActivityState(email);
        state.type = 'typing';
        state.count = 0;
        updateContactList();
    }

    function setContactEditMode(enabled) {
        contactEditMode = !!enabled;

        if (!contactEditMode) {
            selectedContactsForRemoval = {};
        }

        updateEditControls();
        updateContactList();
    }

    function toggleContactSelection(email) {
        if (!contactEditMode) return;

        if (selectedContactsForRemoval[email]) {
            delete selectedContactsForRemoval[email];
        } else {
            selectedContactsForRemoval[email] = true;
        }

        updateEditControls();
        updateContactList();
    }

    function removeSelectedContacts() {
        // collect all contacts that are marked for removal
        var toRemove = [];
        var email;

        for (email in selectedContactsForRemoval) {
            if (selectedContactsForRemoval.hasOwnProperty(email) && selectedContactsForRemoval[email]) {
                toRemove.push(email);
            }
        }

        if (!toRemove.length) {
            showStatus('Select contacts to remove first');
            return;
        }

        // ask for confirmation before deleting
        var confirmed = true;
        if (window && typeof window.confirm === 'function') {
            confirmed = window.confirm('Remove ' + toRemove.length + ' contact' + (toRemove.length === 1 ? '' : 's') + ' from your list?');
        }

        if (!confirmed) {
            return;
        }

        // send remove message for each contact and clean up local data
        for (var i = 0; i < toRemove.length; i++) {
            email = toRemove[i];

            sendMessage({
                type: 'removeContact',
                email: email
            });

            // delete all locally stored data about this contact
            delete contacts[email];
            delete conversations[email];
            delete conversationStates[email];
            delete queuedMessages[email];
            delete typingTimers[email];
        }

        // exit edit mode and refresh the list
        setContactEditMode(false);
        updateContactList();
        queueContactListRefresh();
        showStatus('Removing ' + toRemove.length + ' contact' + (toRemove.length === 1 ? '' : 's') + '...');
    }

    function buildServiceUrl(hostInput, pathSuffix, forceHttp) {
        var host = normalizeHostInput(hostInput);
        if (!host) return '';
        var protocol = forceHttp ? 'http://' : 'https://';
        return protocol + host + pathSuffix;
    }

    function getSelectedServiceConfig() {
        var selectedService = serviceSelect ? serviceSelect.value : 'custom';
        var useCustom = selectedService === 'custom';
        var preset = configuredServices[selectedService] || null;

        if (!useCustom && preset) {
            return {
                server: preset.server,
                port: preset.port,
                nexus: preset.nexus,
                config: preset.config,
                useCustom: false
            };
        }

        return {
            server: serverInput ? trim(serverInput.value) : '',
            port: portInput ? parseInt(portInput.value, 10) : NaN,
            nexus: nexusInput ? trim(nexusInput.value) : '',
            config: configInput ? trim(configInput.value) : '',
            useCustom: true
        };
    }

    function updateServiceFieldsVisibility() {
        var useCustom = !serviceSelect || serviceSelect.value === 'custom';
        var i;

        for (i = 0; i < customServiceRows.length; i++) {
            customServiceRows[i].style.display = useCustom ? 'block' : 'none';
        }

        updateLoginButtonState();
    }
    
    // remove messenger plus formatting tags and truncate if needed
    function cleanDisplayName(name, maxLength) {
        var cleaned = name.replace(/\[.*?\]/g, '');
        if (maxLength && cleaned.length > maxLength) {
            return cleaned.substring(0, maxLength) + '...';
        }
        return cleaned;
    }
    
    // establish websocket connection
    function connectWebSocket() {
        if (!supportsWebSocket()) {
            return;
        }

        var protocol = forceHttpEnabled ? 'ws:' : (window.location.protocol === 'https:' ? 'wss:' : 'ws:');
        var host = window.location.hostname;
        var port = window.location.port ? ':' + window.location.port : '';
        var baseUrl = protocol + '//' + host + port;

        if (!websocketUrls.length) {
            websocketUrls = [
                baseUrl + '/ws',
                baseUrl + '/websocket',
                baseUrl + '/'
            ];
        }

        if (websocketRetryTimer) {
            clearTimeout(websocketRetryTimer);
            websocketRetryTimer = null;
        }

        var wsUrl = websocketUrls[websocketAttemptIndex];
        if (!wsUrl) {
            console.error('[CLIENT_WS] No websocket URLs left to try');
            showError('Connection closed. Please refresh and sign in again.');
            return;
        }
        
        console.log('[CLIENT_WS] Connecting to WebSocket:', wsUrl);
        // suppress automatic opening of chats while we attach and replay history
        suppressAutoOpenChats = true;
        ws = new WebSocket(wsUrl);
        
        ws.onopen = function() {
            websocketOpened = true;
            console.log('[CLIENT_WS] WebSocket connection opened successfully');
            if (pendingLoginMessage) {
                console.log('[CLIENT_WS] Sending queued login message');
                ws.send(JSON.stringify(pendingLoginMessage));
                pendingLoginMessage = null;
            }
        };
        
        ws.onmessage = function(event) {
            try {
                console.log('[CLIENT_WS] Raw message received (length:', event.data.length, ')');
                console.log('[CLIENT_WS] Message data:', event.data);
                var message = JSON.parse(event.data);
                handleServerMessage(message);
            } catch (e) {
                console.error('[CLIENT_WS] Failed to parse message:', e);
                console.error('[CLIENT_WS] Raw message data:', event.data);
            }
        };
        
        ws.onerror = function(error) {
            console.error('[CLIENT_WS] WebSocket error occurred:', error);
        };
        
        ws.onclose = function() {
            console.log('[CLIENT_WS] WebSocket connection closed');
            console.log('[CLIENT_WS] isRedirecting flag:', isRedirecting);
            if (websocketOpened) {
                websocketOpened = false;
                return;
            }

            websocketAttemptIndex += 1;
            if (pendingLoginMessage && websocketAttemptIndex < websocketUrls.length) {
                websocketRetryTimer = setTimeout(function() {
                    connectWebSocket();
                }, 250);
                return;
            }

            if (!isRedirecting && loginAttemptActive) {
                showError('Connection closed. Please refresh and sign in again.');
            }
        };
    }

    function connectPollingTransport() {
        var pollUrl;

        if (pollingActive) {
            return;
        }

        pollingActive = true;
        pollingCursor = 0;
        pollUrl = '/api/poll';

        function pollOnce() {
            if (!pollingActive) {
                return;
            }

            sendGetRequest(pollUrl + '?cursor=' + encodeURIComponent(String(pollingCursor)), function(status, responseText) {
                var response;
                var i;

                if (!pollingActive) {
                    return;
                }

                if (status < 200 || status >= 300) {
                    pollingTimer = setTimeout(pollOnce, 1000);
                    return;
                }

                try {
                    response = JSON.parse(responseText);
                } catch (parseError) {
                    pollingTimer = setTimeout(pollOnce, 1000);
                    return;
                }

                if (response.type === 'events' && response.messages) {
                    if (response.cursor && response.cursor > pollingCursor) {
                        pollingCursor = response.cursor;
                    }

                    for (i = 0; i < response.messages.length; i++) {
                        handleServerMessage(response.messages[i]);
                    }
                } else if (response.type === 'disconnected') {
                    handleServerMessage(response);
                    stopPollingTransport();
                    return;
                }

                pollingTimer = setTimeout(pollOnce, 1000);
            });
        }

        pollOnce();
    }
    
    function sendMessage(message) {
        console.log('[CLIENT_SEND] Attempting to send message, type:', message.type);
        if (message.type === 'login') {
            console.log('[CLIENT_SEND] Login message details - Email:', message.email);
        }
        if (pollingActive) {
            sendJsonRequest('/api/command', message, function(status, responseText) {
                var response;

                if (status < 200 || status >= 300) {
                    showError('Not connected to server');
                    return;
                }

                if (!responseText) {
                    return;
                }

                try {
                    response = JSON.parse(responseText);
                } catch (parseError) {
                    return;
                }

                if (response && response.type && response.type !== 'ok') {
                    handleServerMessage(response);
                }
            });
            return;
        }

        if (ws && supportsWebSocket() && ws.readyState === window.WebSocket.OPEN) {
            var jsonStr = JSON.stringify(message);
            console.log('[CLIENT_SEND] WebSocket ready, sending JSON (length:', jsonStr.length, ')');
            ws.send(jsonStr);
            console.log('[CLIENT_SEND] Message sent successfully');
        } else {
            console.error('[CLIENT_SEND] WebSocket not ready, readyState:', ws ? ws.readyState : 'null');
            showError('Not connected to server');
        }
    }

    function sendJsonRequest(url, payload, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) {
                return;
            }
            callback(xhr.status, xhr.responseText);
        };
        xhr.send(JSON.stringify(payload));
    }

    function sendGetRequest(url, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) {
                return;
            }
            callback(xhr.status, xhr.responseText);
        };
        xhr.send(null);
    }

    function checkExistingSession() {
        sendGetRequest('/api/session', function(status, responseText) {
            var response;

            if (status < 200 || status >= 300) {
                return;
            }

            try {
                response = JSON.parse(responseText);
            } catch (parseError) {
                return;
            }

            if (response.type === 'authenticated') {
                // Prefill profile fields from session response so the UI isn't empty
                if (response.email) {
                    ownProfile.email = response.email;
                    // also populate the login email input so `getUserEmail()` and other
                    // code that reads the login box remain consistent after auto-login
                    var emailEl = document.getElementById('email');
                    if (emailEl) {
                        try { emailEl.value = response.email; } catch (e) {}
                    }
                }
                if (response.display_name) {
                    ownProfile.displayName = response.display_name;
                }
                if (response.personal_message) {
                    ownProfile.personalMessage = response.personal_message;
                }
                renderOwnProfile();
                // now attach the active transport to receive live updates
                connectCurrentTransport();
            }
        });
    }
    
    function handleServerMessage(message) {
        if (message.type !== 'typing') { // Don't log typing notifs since otherwise it'll blow up the console
            console.log('[CLIENT_RECEIVE] Received message type:', message.type);
        }
        
        // switch-case of doom and despair
        switch (message.type) {
            case 'redirected':
                console.log('[CLIENT_RECEIVE] Redirect message received');
                handleRedirect(message.server, message.port);
                break;
            case 'authenticated':
                console.log('[CLIENT_RECEIVE] Authenticated message received - login successful!');
                handleAuthenticated();
                break;
            case 'error':
                console.error('[CLIENT_RECEIVE] Error message received:', message.message);
                console.error('[CLIENT_RECEIVE] Full error object:', JSON.stringify(message));
                showError(message.message);
                break;
            case 'contact':
                handleContact(message);
                break;
            case 'group':
                handleGroup(message);
                break;
            case 'presenceUpdate':
                handlePresenceUpdate(message);
                break;
            case 'personalMessageUpdate':
                handlePersonalMessageUpdate(message);
                break;
            case 'displayName':
                handleDisplayNameUpdate(message.display_name);
                break;
            case 'contactOffline':
                handleContactOffline(message.email);
                break;
            case 'addedBy':
                handleAddedBy(message);
                break;
            case 'removedBy':
                handleRemovedBy(message.email);
                break;
            case 'conversationReady':
                console.log('[CLIENT] ConversationReady received for:', message.email);
                handleConversationReady(message.email);
                break;
            case 'textMessage':
                handleTextMessage(message);
                break;
            case 'nudge':
                handleNudge(message.email);
                break;
            case 'typing':
                handleTypingNotification(message.email);
                break;
            case 'participantJoined':
                console.log('[CLIENT] ParticipantJoined received for:', message.email);
                handleParticipantJoined(message.email);
                break;
            case 'participantLeft':
                handleParticipantLeft(message.email);
                break;
            case 'displayPicture':
                handleDisplayPicture(message);
                break;
            case 'disconnected':
                handleDisconnected(message);
                break;
        }
    }
    
    function handleLogin(e) {
        if (e) e.preventDefault();

        var email = trim(document.getElementById('email').value);
        var password = document.getElementById('password').value;
        var serviceConfig = getSelectedServiceConfig();
        var server = serviceConfig.server;
        var port = serviceConfig.port;
        var forceHttp = forceHttpToggle ? !!forceHttpToggle.checked : false;
        var nexusUrl = buildServiceUrl(serviceConfig.nexus, '/rdr/pprdr.asp', forceHttp);
        var configServer = buildServiceUrl(serviceConfig.config, '/Config/MsgrConfig.asmx', forceHttp);
        var emailCharCodes = [];
        var emailIdx;
        
        console.log('[CLIENT_LOGIN] Login attempt initiated');
        console.log('[CLIENT_LOGIN] Email entered:', email);
        console.log('[CLIENT_LOGIN] Email length:', email.length);
        for (emailIdx = 0; emailIdx < email.length; emailIdx++) {
            emailCharCodes.push(email.charCodeAt(emailIdx));
        }
        console.log('[CLIENT_LOGIN] Email char codes:', emailCharCodes);
        console.log('[CLIENT_LOGIN] Password length:', password.length);
        console.log('[CLIENT_LOGIN] Server:', server, ':', port);
        console.log('[CLIENT_LOGIN] Nexus URL:', nexusUrl);
        console.log('[CLIENT_LOGIN] Config Server:', configServer || '(none)');
        console.log('[CLIENT_LOGIN] Force HTTP:', forceHttp);

        if (loginRedirectOverride) {
            if (loginRedirectOverride.server) {
                server = loginRedirectOverride.server;
            }
            if (loginRedirectOverride.port) {
                port = loginRedirectOverride.port;
            }
            loginRedirectOverride = null;
        }

        ownProfile.email = email;
        ownProfile.displayName = '';
        ownProfile.personalMessage = '';
        renderOwnProfile();
        
        if (!email || !password || !server || !port || !nexusUrl || !configServer) {
            console.error('[CLIENT_LOGIN] Validation failed - missing required fields');
            showError('Please fill in all required fields');
            updateLoginButtonState();
            return;
        }
        
        console.log('[CLIENT_LOGIN] Validation passed, preparing login message');
        forceHttpEnabled = forceHttp;
        loginAttemptActive = true;
        loginBtn.disabled = true;
        loginBtn.innerHTML = 'Signing in...';
        hideError();
        hideStatus();

        sendJsonRequest('/api/login', {
            type: 'login',
            email: email,
            password: password,
            server: server,
            port: port,
            nexus_url: nexusUrl,
            config_server: configServer || null
        }, function(status, responseText) {
            var response;

            if (status < 200 || status >= 300) {
                loginAttemptActive = false;
                showError('Login failed');
                return;
            }

            try {
                response = JSON.parse(responseText);
            } catch (parseError) {
                loginAttemptActive = false;
                showError('Login failed');
                return;
            }

            if (response.type === 'redirected') {
                loginAttemptActive = true;
                showStatus('Redirecting to ' + response.server + ':' + response.port + '...');
                serverInput.value = response.server;
                portInput.value = String(response.port);
                loginRedirectOverride = {
                    server: response.server,
                    port: response.port
                };
                setTimeout(function() {
                    handleLogin();
                }, 1000);
                return;
            }

            if (response.type === 'authenticated') {
                loginAttemptActive = false;
                if (response.email) {
                    ownProfile.email = response.email;
                    var loginEmailEl = document.getElementById('email');
                    if (loginEmailEl) {
                        try { loginEmailEl.value = response.email; } catch (e) {}
                    }
                }
                if (response.display_name) {
                    ownProfile.displayName = response.display_name;
                }
                if (response.personal_message) {
                    ownProfile.personalMessage = response.personal_message;
                }
                renderOwnProfile();
                if (ws) {
                    try {
                        ws.close();
                    } catch (closeError) {
                    }
                }
                showStatus('Signed in successfully!');
                connectCurrentTransport();
                return;
            }

            loginAttemptActive = false;
            showError(response.message || 'Login failed');
        });
    }
    
    function handleAuthenticated() {
        loginAttemptActive = false;
        loginBtn.disabled = false;
        loginBtn.innerHTML = 'Signed in!';
        setChatSlideOpen(false);
        hideError();
        showStatus('Signed in successfully!');
        renderOwnProfile();
        
        setTimeout(function() {
            loginScreen.style.display = 'none';
            mainScreen.style.display = 'block';
            updateWindowTitle();
            // resize the contact list now that the main screen is visible
            setTimeout(adjustContactListHeight, 50);
            // allow some time for server history replay before enabling auto-open
            setTimeout(function() { suppressAutoOpenChats = false; }, 500);
        }, 500);
    }
    
    function handleContact(contact) {
        contacts[contact.email] = {
            email: contact.email,
            displayName: contact.display_name,
            status: 'Offline',
            personalMessage: '',
            lists: contact.lists,
            groups: contact.groups || []
        };
        updateContactList();
    }
    
    function handleGroup(group) {
        console.log('Group:', group.name, group.guid);
    }
    
    function handlePresenceUpdate(update) {
        if (contacts[update.email]) {
            contacts[update.email].displayName = update.display_name;
            contacts[update.email].status = update.status;
            updateContactList();
        }
    }
    
    function handlePersonalMessageUpdate(update) {
        // compare against the authoritative profile email populated from the server
        if (ownProfile && ownProfile.email && update.email === ownProfile.email) {
            ownProfile.personalMessage = update.message || '';
            renderOwnProfile();
        }

        if (contacts[update.email]) {
            contacts[update.email].personalMessage = update.message;
            updateContactList();
        }
    }

    function handleDisplayNameUpdate(displayName) {
        ownProfile.displayName = displayName || '';
        renderOwnProfile();
        updateWindowTitle();
    }

    function renderOwnProfile() {
        if (currentEmail) {
            if (ownProfile.email && ownProfile.email.length) {
                currentEmail.textContent = ownProfile.email;
                removeClass(currentEmail, 'profile-value-empty');
            } else {
                currentEmail.textContent = '(not available)';
                addClass(currentEmail, 'profile-value-empty');
            }
        }

        if (currentDisplayName) {
            if (ownProfile.displayName && ownProfile.displayName.length) {
                currentDisplayName.textContent = ownProfile.displayName;
                removeClass(currentDisplayName, 'profile-value-empty');
            } else {
                currentDisplayName.textContent = '(not available)';
                addClass(currentDisplayName, 'profile-value-empty');
            }
        }

        if (currentPersonalMessage) {
            if (ownProfile.personalMessage && ownProfile.personalMessage.length) {
                currentPersonalMessage.textContent = ownProfile.personalMessage;
                removeClass(currentPersonalMessage, 'profile-value-empty');
            } else {
                currentPersonalMessage.textContent = '(none)';
                addClass(currentPersonalMessage, 'profile-value-empty');
            }
        }

        updateWindowTitle();
    }
    
    function handleContactOffline(email) {
        if (contacts[email]) {
            contacts[email].status = 'Offline';
            updateContactList();
        }
    }
    
    function handleAddedBy(data) {
        showStatus(data.display_name + ' (' + data.email + ') added you to their contact list');
    }
    
    function handleRemovedBy(email) {
        if (contacts[email]) {
            delete contacts[email];
            updateContactList();
            queueContactListRefresh();
        }
        showStatus(email + ' removed you from their contact list');
    }
    
    function handleConversationReady(email) {
        console.log('[CLIENT] handleConversationReady - email:', email, '| conversations[email]:', !!conversations[email], '| currentContact:', currentContact);
        if (!conversations[email]) {
            conversations[email] = [];
        }
        conversationStates[email] = 'ready';
        flushQueuedMessages(email);

        if (!currentContact || currentContact === email) {
            if (!suppressAutoOpenChats) {
                openChat(email);
                console.log('[CLIENT] handleConversationReady - chat opened for', email);
            } else {
                console.log('[CLIENT] handleConversationReady - suppressed auto-open for', email);
                updateContactList();
            }
        } else {
            console.log('[CLIENT] handleConversationReady - chat kept in background for', email);
            updateContactList();
        }
    }
    
    function handleTextMessage(msg) {
        console.log('[CLIENT] handleTextMessage - from:', msg.email, '| text:', msg.message);
        conversationStates[msg.email] = 'ready';
        if (!conversations[msg.email]) {
            conversations[msg.email] = [];
            console.log('[CLIENT] handleTextMessage - initialized conversation for', msg.email);
        }
        
        var message = {
            sender: msg.email,
            text: msg.message,
            time: new Date(),
            color: msg.color
        };
        
        conversations[msg.email].push(message);
        console.log('[CLIENT] handleTextMessage - message stored | currentContact:', currentContact, '| sender:', msg.email);
        
        if (currentContact === msg.email) {
            console.log('Displaying message in UI');
            displayMessage(message, false);
            scrollToBottom();
            clearContactActivityState(msg.email);
            updateContactList();
        } else {
            markUnreadMessage(msg.email);
        }
    }
    
    function handleNudge(email) { 
        // Always show a visible shake so the user notices the nudge
        try {
            var target = document.getElementById('chatScreen') || document.body || document.documentElement;
            if (target) {
                target.style.webkitAnimation = 'shake 1s';
                target.style.animation = 'shake 1s';
                setTimeout(function() {
                    try { target.style.webkitAnimation = ''; target.style.animation = ''; } catch (e) {}
                }, 1000);
            }
        } catch (e) {}

        // If the nudge is for the active chat, add an inline system message to the conversation
        if (currentContact === email) {
            addSystemMessage((contacts[email] ? cleanDisplayName(contacts[email].displayName, 28) : email) + ' sent you a nudge!');
        } else {
            // for background chats, mark activity so the contact list shows attention
            markUnreadMessage(email);
        }

        // vibrate if available
        if (window.navigator && window.navigator.vibrate) {
            try { window.navigator.vibrate(1000); } catch (e) {}
        }
    }
    
    // display when someone is typing (note: not fully working yet)
    function handleTypingNotification(email) {
        if (currentContact === email) {
            showTypingIndicator(email);
            return;
        }

        markTypingActivity(email);
    }
    
    function handleParticipantJoined(email) {
        console.log('[CLIENT] handleParticipantJoined - email:', email, '| conversations[email]:', !!conversations[email], '| currentContact:', currentContact);
        conversationStates[email] = 'ready';
        flushQueuedMessages(email);
        
        // set up the conversation array if this is the first message
        if (!conversations[email]) {
            conversations[email] = [];
            console.log('[CLIENT] handleParticipantJoined - initialized conversations array for', email);
        }
        
        // if nothing is open yet, show the new chat. otherwise keep it in the background.
        if (!currentContact) {
            if (!suppressAutoOpenChats) {
                console.log('[CLIENT] handleParticipantJoined - opening chat for', email);
                openChat(email);
            } else {
                console.log('[CLIENT] handleParticipantJoined - suppressed auto-open for', email);
                // still show a system notice in background so UI indicates activity
                addSystemMessage(email + ' joined the conversation');
            }
        } else {
            // already chatting with them, just notify the user they joined
            console.log('[CLIENT] handleParticipantJoined - already in chat with', email, '- adding system message');
            addSystemMessage(email + ' joined the conversation');
        }
    }
    
    function handleParticipantLeft(email) {
        if (currentContact === email) {
            addSystemMessage(email + ' left the conversation');
        }
    }
    
    function handleDisconnected(message) {
        var reason = (message && message.message) ? message.message : 'Conversation disconnected';
        var chatLayoutMode = getChatLayoutMode();
        console.warn('[CLIENT] Disconnected event received:', message);

        // handle disconnection gracefully without forcing a full logout
        if (chatScreen.style.display !== 'none' && currentContact) {
            delete conversationStates[currentContact];
            delete queuedMessages[currentContact];
            addSystemMessage(reason);
            if (chatLayoutMode === 'embedded' || chatLayoutMode === 'slide') {
                chatScreen.style.display = 'none';
                mainScreen.style.display = 'block';
                setChatSlideOpen(false);
            } else {
                chatScreen.style.display = 'none';
                mainScreen.style.display = 'block';
            }
            adjustContactListHeight();
            currentContact = null;
            updateWindowTitle();
            return;
        }

        showStatus(reason);
        updateWindowTitle();
    }
    
    function updateContactList() {
        contactList.innerHTML = '';
        
        var sortedContacts = [];
        for (var email in contacts) {
            if (contacts.hasOwnProperty(email)) {
                sortedContacts.push(contacts[email]);
            }
        }
        
        sortedContacts.sort(function(a, b) {
            // show online people first
            var aOnline = a.status !== 'Offline';
            var bOnline = b.status !== 'Offline';
            if (aOnline !== bOnline) return bOnline - aOnline;
            
            // then sort by their display name
            return a.displayName.localeCompare(b.displayName);
        });
        
        for (var i = 0; i < sortedContacts.length; i++) {
            var contact = sortedContacts[i];
            var item = createContactItem(contact);
            contactList.appendChild(item);
        }
    }
    
    function createContactItem(contact) {
        var item = document.createElement('div');
        item.className = 'contact-item';
        if (contactEditMode) {
            item.className += ' edit-mode';
        }

        if (currentContact === contact.email) {
            item.className += ' active-chat';
        }
        
        var statusIndicator = document.createElement('div');
        statusIndicator.className = 'contact-status ' + getStatusClass(contact.status);
        
        var info = document.createElement('div');
        info.className = 'contact-info';
        
        var name = document.createElement('div');
        name.className = 'contact-name';
        name.textContent = cleanDisplayName(contact.displayName);
        
        var email = document.createElement('div');
        email.className = 'contact-email';
        email.textContent = contact.email;
        
        info.appendChild(name);
        info.appendChild(email);
        
        if (contact.personalMessage) {
            var psm = document.createElement('div');
            psm.className = 'contact-psm';
            psm.textContent = contact.personalMessage;
            info.appendChild(psm);
        }
        
        if (contactEditMode) {
            var selectIndicator = document.createElement('input');
            selectIndicator.type = 'checkbox';
            selectIndicator.disabled = true;
            selectIndicator.className = 'contact-select-indicator';
            selectIndicator.checked = !!selectedContactsForRemoval[contact.email];
            item.appendChild(selectIndicator);

            if (selectedContactsForRemoval[contact.email]) {
                item.className += ' selected';
            }
        }

        var activityIndicator = document.createElement('div');
        activityIndicator.className = 'contact-activity-indicator';
        if (contactEditMode) {
            activityIndicator.className += ' edit-indicator';
            activityIndicator.textContent = selectedContactsForRemoval[contact.email] ? '✓' : '';
        } else if (contactActivityState[contact.email]) {
            if (contactActivityState[contact.email].type === 'typing') {
                activityIndicator.className += ' typing-indicator-slot';
                activityIndicator.textContent = 'typing';
            } else if (contactActivityState[contact.email].type === 'unread') {
                activityIndicator.className += ' unread-indicator-slot';
                activityIndicator.textContent = contactActivityState[contact.email].count > 1 ? String(contactActivityState[contact.email].count) : '•';
            }
        }

        item.appendChild(statusIndicator);
        item.appendChild(info);
        item.appendChild(activityIndicator);
        
        item.onclick = function() {
            if (contactEditMode) {
                toggleContactSelection(contact.email);
                return;
            }
            startConversation(contact.email);
        };
        
        return item;
    }
    
    function getStatusClass(status) {
        if (status === 'Online' || status === 'Idle') return 'online';
        if (status === 'Busy' || status === 'OnThePhone') return 'busy';
        if (status === 'Away' || status === 'BeRightBack' || status === 'OutToLunch') return 'away';
        return 'offline';
    }
    
    function startConversation(email) {
        console.log('startConversation called for:', email);
        if (conversationStates[email] === 'ready') {
            console.log('Conversation already ready, opening chat for:', email);
            openChat(email);
            return;
        }

        if (conversationStates[email] === 'starting') {
            console.log('Conversation already starting for:', email);
            return;
        }

        if (!conversations[email]) {
            conversations[email] = [];
        }

        conversationStates[email] = 'starting';
        if (isTransportReady()) {
            console.log('Sending startConversation request for:', email);
            sendMessage({
                type: 'startConversation',
                email: email
            });
        } else {
            console.warn('Transport not ready, cannot start conversation yet for:', email);
            showStatus('Connecting... please try again.');
        }
    }

    function queueMessage(email, text) {
        if (!queuedMessages[email]) {
            queuedMessages[email] = [];
        }
        queuedMessages[email].push(text);
    }

    function sendChatMessage(email, text) {
        if (!text || !email) return;

        console.log('[CLIENT] Sending message to', email, '- text:', text.substring(0, 50));
        sendMessage({
            type: 'sendMessage',
            email: email,
            message: text
        });

        var msg = {
            sender: getUserEmail(),
            text: text,
            time: new Date()
        };

        if (!conversations[email]) {
            conversations[email] = [];
        }
        conversations[email].push(msg);

        if (currentContact === email) {
            displayMessage(msg, true);
            scrollToBottom();
        }
    }

    function flushQueuedMessages(email) {
        if (!queuedMessages[email] || !queuedMessages[email].length) {
            return;
        }

        while (queuedMessages[email].length) {
            sendChatMessage(email, queuedMessages[email].shift());
        }
        delete queuedMessages[email];
    }
    
    function openChat(email) {
        var chatLayoutMode = getChatLayoutMode();
        currentContact = email;
        var contact = contacts[email];

        clearContactActivityState(email);
        updateContactList();
        
        if (contact) {
            chatTitle.textContent = cleanDisplayName(contact.displayName, 28);
        } else {
            // Truncate email if too long
            chatTitle.textContent = email.length > 28 ? email.substring(0, 28) + '...' : email;
        }
        
        messageContainer.innerHTML = '';
        messageInput.value = ''; // reset the message input when switching to a new contact
        
        if (conversations[email] && conversations[email].length) {
            for (var i = 0; i < conversations[email].length; i++) {
                var msg = conversations[email][i];
                displayMessage(msg, msg.sender === getUserEmail());
            }
        }
        
        if (chatLayoutMode === 'embedded') {
            mainScreen.style.display = 'block';
            chatScreen.style.display = 'flex';
        } else if (chatLayoutMode === 'slide') {
            mainScreen.style.display = 'block';
            chatScreen.style.display = 'flex';
            setChatSlideOpen(true);
        } else {
            mainScreen.style.display = 'none';
            chatScreen.style.display = 'flex';
        }
        updateWindowTitle();
        messageInput.focus();
        scrollToBottom();
    }
    
    function getUserEmail() {
        // Prefer the server-provided profile email (populated on session restore)
        if (ownProfile && ownProfile.email && ownProfile.email.length) {
            return ownProfile.email;
        }

        var emailEl = document.getElementById('email');
        return emailEl ? trim(emailEl.value) : '';
    }
    
    function displayMessage(message, isSent) {
        console.log('displayMessage called, isSent:', isSent, 'message:', message);
        console.log('messageContainer element:', messageContainer);
        
        if (!messageContainer) {
            console.error('messageContainer is null or undefined!');
            return;
        }
        
        var msgDiv = document.createElement('div');
        msgDiv.className = 'message ' + (isSent ? 'message-sent' : 'message-received');
        console.log('Created msgDiv with className:', msgDiv.className);
        
        var bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        
        if (!isSent) {
            var sender = document.createElement('div');
            sender.className = 'message-sender';
            sender.textContent = message.sender;
            bubble.appendChild(sender);
        }
        
        var text = document.createElement('div');
        var parsed = parseEmoticons(message.text);
        if (typeof parsed === 'string') {
            text.textContent = parsed;
        } else {
            // emoticon parsing returned a container element with text and images mixed in
            while (parsed.firstChild) {
                text.appendChild(parsed.firstChild);
            }
        }
        bubble.appendChild(text);
        console.log('Message text:', message.text);
        
        var time = document.createElement('div');
        time.className = 'message-time';
        time.textContent = formatTime(message.time);
        bubble.appendChild(time);
        
        msgDiv.appendChild(bubble);
        messageContainer.appendChild(msgDiv);
        console.log('Message appended to messageContainer, total messages:', messageContainer.children.length);
    }
    
    function addSystemMessage(text) {
        var msgDiv = document.createElement('div');
        msgDiv.className = 'message-system';
        msgDiv.textContent = text;
        messageContainer.appendChild(msgDiv);
        scrollToBottom();
    }
    
    // display a typing indicator for a specific contact (buggy, needs fixing)
    function showTypingIndicator(email) {
        markTypingActivity(email);

        if (typingTimers[email]) {
            clearTimeout(typingTimers[email]);
        }
        
        typingTimers[email] = setTimeout(function() {
            clearTypingActivity(email);
            delete typingTimers[email];
        }, 3000);
    }
    
    function formatTime(date) {
        var hours = date.getHours();
        var minutes = date.getMinutes();
        var ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        minutes = minutes < 10 ? '0' + minutes : minutes;
        return hours + ':' + minutes + ' ' + ampm;
    }
    
    function scrollToBottom() {
        setTimeout(function() {
            messageContainer.scrollTop = messageContainer.scrollHeight;
        }, 100);
    }
    
    function handleSendMessage() {
        var text = trim(messageInput.value);
        console.log('handleSendMessage called, text:', text, 'currentContact:', currentContact);
        if (!text || !currentContact) return;

        if (conversationStates[currentContact] !== 'ready') {
            queueMessage(currentContact, text);
            startConversation(currentContact);
            showStatus('Starting conversation...');
            messageInput.value = '';
            return;
        }

        sendChatMessage(currentContact, text);
        messageInput.value = '';
    }
    
    // track typing notifications (disabled for now due to bugs)
    var typingTimeout = null;
    function handleTypingInput() {
        return; // typing notifications are currently disabled
    }
    
    function handleNudgeBtn() {
        if (!currentContact) return;
        
        sendMessage({
            type: 'sendNudge',
            email: currentContact
        });
        
        addSystemMessage('You sent a nudge');
    }
    
    function closeChat() {
        var chatLayoutMode = getChatLayoutMode();
        if (currentContact && conversationStates[currentContact]) {
            conversationStates[currentContact] = 'ready';
        }
        
        currentContact = null;
        chatScreen.style.display = 'none';
        mainScreen.style.display = 'block';
        if (chatLayoutMode === 'slide') {
            setChatSlideOpen(false);
        }
        updateWindowTitle();
        adjustContactListHeight();
    }
    
    function handleStatusChange() {
        var status = statusSelect.value;
        console.log('Setting status to:', status);
        sendMessage({
            type: 'setPresence',
            status: status
        });
    }
    
    function handleSetPsm() {
        var message = trim(personalMessageInput.value);
        console.log('Setting personal message to:', message);
        sendMessage({
            type: 'setPersonalMessage',
            message: message
        });
        ownProfile.personalMessage = message;
        renderOwnProfile();
        personalMessageInput.value = '';
    }

    function handleSetDisplayName() {
        var displayName = displayNameInput ? trim(displayNameInput.value) : '';
        if (!displayName) {
            showStatus('Username cannot be empty');
            return;
        }

        sendMessage({
            type: 'setDisplayName',
            display_name: displayName
        });

        ownProfile.displayName = displayName;
        renderOwnProfile();
        displayNameInput.value = '';
        showStatus('Username updated');
    }

    function showAddContactModal() {
        if (!addContactModal) return;
        addContactModal.style.display = addContactModal.className && addContactModal.className.indexOf('modal-overlay') !== -1 ? 'flex' : 'block';
        if (addContactInput) {
            addContactInput.value = '';
        }
        if (addContactInput && addContactInput.focus) {
            addContactInput.focus();
        }
    }

    function hideAddContactModal() {
        if (!addContactModal) return;
        addContactModal.style.display = 'none';
    }
    
    function handleAddContact() {
        var email = trim(addContactInput.value);
        if (!email) return;
        
        console.log('[CLIENT] Adding contact:', email);
        sendMessage({
            type: 'addContact',
            email: email
        });

        // pre-populate the contact list with this new contact
        if (!contacts[email]) {
            contacts[email] = {
                email: email,
                displayName: email,
                status: 'Offline',
                personalMessage: '',
                lists: ['ForwardList'],
                groups: []
            };
            updateContactList();
        }
        queueContactListRefresh();
        
        addContactInput.value = '';
        hideAddContactModal();
        showStatus('Contact request sent');
    }
    
    function handleLogout() {
        sendJsonRequest('/api/logout', {
            type: 'logout'
        }, function(status) {
            if (status < 200 || status >= 300) {
                showError('Logout failed');
                return;
            }

            // clear out all local data before the page comes back up signed out
            contacts = {};
            conversations = {};
            currentContact = null;
            conversationUnreadCounts = {};
            contactActivityState = {};
            setContactEditMode(false);
            updateWindowTitle();
            stopPollingTransport();

            if (ws) {
                try {
                    ws.close();
                } catch (closeError) {
                }
            }

            window.location.reload();
        });
    }

    function handleReload() {
        window.location.reload();
    }
    
    function showError(message) {
        loginError.textContent = message;
        loginError.style.whiteSpace = 'pre-line';
        loginError.style.display = 'block';
        loginBtn.disabled = false;
        loginBtn.innerHTML = 'Sign In';
        updateLoginButtonState();
    }
    
    function hideError() {
        loginError.style.display = 'none';
    }
    
    function showStatus(message) {
        loginStatus.textContent = message;
        loginStatus.style.display = 'block';
    }
    
    function hideStatus() {
        loginStatus.style.display = 'none';
    }

    function addClass(el, className) {
        if (!el) return;
        // use the modern classList api if available
        if (el.classList) {
            el.classList.add(className);
            return;
        }

        // fallback for older browsers: manually manipulate the class string
        if ((' ' + el.className + ' ').indexOf(' ' + className + ' ') === -1) {
            el.className = el.className ? el.className + ' ' + className : className;
        }
    }

    function removeClass(el, className) {
        if (!el) return;
        // use the modern classList api if available
        if (el.classList) {
            el.classList.remove(className);
            return;
        }

        // fallback for older browsers: use regex to remove the class
        el.className = el.className.replace(new RegExp('(^|\\s)' + className + '(?=\\s|$)', 'g'), ' ').replace(/\s+/g, ' ').replace(/^\s|\s$/g, '');
    }

    function updateLoginButtonState() {
        var allFilled = true;
        var emailInput = document.getElementById('email');
        var passwordInput = document.getElementById('password');
        var serviceConfig;

        if (!emailInput.value || !trim(emailInput.value) || !passwordInput.value || !trim(passwordInput.value)) {
            allFilled = false;
        }

        if (allFilled && serviceSelect && !serviceSelect.value) {
            allFilled = false;
        }

        if (allFilled && serviceSelect && serviceSelect.value === 'custom') {
            serviceConfig = getSelectedServiceConfig();
            if (!serviceConfig.server || !serviceConfig.port || !serviceConfig.nexus || !serviceConfig.config) {
                allFilled = false;
            }
        }

        if (allFilled) {
            addClass(loginBtn, 'login-ready');
        } else {
            removeClass(loginBtn, 'login-ready');
        }
    }
    
    // load emoticon packs when the app starts
    loadAvailableEmoticonPacks();
    
    // wire up all the button clicks and form submissions
    on(loginForm, 'submit', handleLogin);
    on(loginBtn, 'click', handleLogin);

    for (var requiredIndex = 0; requiredIndex < requiredLoginInputs.length; requiredIndex++) {
        on(requiredLoginInputs[requiredIndex], 'input', updateLoginButtonState);
        on(requiredLoginInputs[requiredIndex], 'change', updateLoginButtonState);
        on(requiredLoginInputs[requiredIndex], 'keyup', updateLoginButtonState);
    }

    on(statusSelect, 'change', handleStatusChange);
    if (serviceSelect) {
        on(serviceSelect, 'change', updateServiceFieldsVisibility);
    }
    if (emoticonPackSelect) {
        on(emoticonPackSelect, 'change', handleEmoticonPackChange);
    }
    if (reloadBtn) {
        on(reloadBtn, 'click', handleReload);
    }
    if (editContactsBtn) {
        on(editContactsBtn, 'click', function() {
            setContactEditMode(!contactEditMode);
        });
    }
    if (removeContactsBtn) {
        on(removeContactsBtn, 'click', removeSelectedContacts);
    }
    on(logoutBtn, 'click', handleLogout);
    if (setDisplayNameBtn) {
        on(setDisplayNameBtn, 'click', handleSetDisplayName);
    }
    on(setPsmBtn, 'click', handleSetPsm);
    on(openAddContactBtn, 'click', showAddContactModal);
    on(addContactBtn, 'click', handleAddContact);
    on(closeAddContactBtn, 'click', hideAddContactModal);
    on(submitAddContactBtn, 'click', handleAddContact);
    if (addContactModal) {
        on(addContactModal, 'click', function(e) {
            if (e.target === addContactModal) {
                hideAddContactModal();
            }
        });
    }
    on(nudgeBtn, 'click', handleNudgeBtn);
    on(closeChatBtn, 'click', closeChat);
    
    // when user hits enter in message input, send the message
    on(messageInput, 'keypress', function(e) {
        if (e.keyCode === 13 || e.which === 13) {
            handleSendMessage();
            e.preventDefault();
        }
    });
    
    // settings section can expand/collapse
    var toggleSettings = document.getElementById('toggleSettings');
    var settingsSection = document.getElementById('settingsSection');

    if (toggleSettings && settingsSection) {
        on(toggleSettings, 'click', function() {
            var section = toggleSettings.parentNode;
            if (settingsSection.style.display === 'none') {
                settingsSection.style.display = 'block';
                toggleSettings.textContent = 'Settings ▲';
                if (section && section.classList) section.classList.add('open');
            } else {
                settingsSection.style.display = 'none';
                toggleSettings.textContent = 'Settings ▼';
                if (section && section.classList) section.classList.remove('open');
            }
            adjustContactListHeight();
        });
    }
    
    // handle various input field changes
    on(messageInput, 'keyup', handleTypingInput);
    
    if (personalMessageInput) on(personalMessageInput, 'keypress', function(e) {
        if (e.keyCode === 13) {
            handleSetPsm();
            e.preventDefault();
        }
    });

    if (displayNameInput) {
        on(displayNameInput, 'keypress', function(e) {
            if (e.keyCode === 13) {
                handleSetDisplayName();
                e.preventDefault();
            }
        });
    }
    
    if (addContactInput) on(addContactInput, 'keypress', function(e) {
        if (e.keyCode === 13 || e.which === 13) {
            handleAddContact();
            e.preventDefault();
        }
    });

    if (serverInput) {
        on(serverInput, 'input', updateLoginButtonState);
        on(serverInput, 'change', updateLoginButtonState);
        on(serverInput, 'keyup', updateLoginButtonState);
    }

    if (nexusInput) {
        on(nexusInput, 'input', updateLoginButtonState);
        on(nexusInput, 'change', updateLoginButtonState);
        on(nexusInput, 'keyup', updateLoginButtonState);
    }

    if (configInput) {
        on(configInput, 'input', updateLoginButtonState);
        on(configInput, 'change', updateLoginButtonState);
        on(configInput, 'keyup', updateLoginButtonState);
    }

    if (forceHttpToggle) {
        on(forceHttpToggle, 'change', updateLoginButtonState);
    }

    if (portInput) {
        on(portInput, 'input', function() {
            // strip out all non-digit characters
            var digitsOnly = this.value.replace(/[^0-9]/g, '');
            if (!digitsOnly) {
                this.value = '';
                return;
            }

            // enforce valid port range (1-65535)
            var portNumber = parseInt(digitsOnly, 10);
            if (portNumber > 65535) portNumber = 65535;
            if (portNumber < 1) portNumber = 1;
            this.value = String(portNumber);
        });

        on(portInput, 'keypress', function(e) {
            // allow backspace, tab, enter, escape, delete
            var charCode = e.which || e.keyCode;
            if (charCode === 8 || charCode === 9 || charCode === 13 || charCode === 27 || charCode === 46) {
                return;
            }

            // block any non-digit character (ascii 48-57 are digits)
            if (charCode < 48 || charCode > 57) {
                e.preventDefault();
            }
        });

        on(portInput, 'paste', function(e) {
            // grab the pasted text from clipboard
            var clipboard = e.clipboardData || window.clipboardData;
            if (!clipboard) return;

            var pasted = clipboard.getData('text');
            // if there are any non-digits, clean them out
            if (/[^0-9]/.test(pasted)) {
                e.preventDefault();
                // remove non-digits and limit to 5 characters
                this.value = pasted.replace(/[^0-9]/g, '').slice(0, 5);
            }
        });
    }
    
    function adjustContactListHeight() {
        // calculate how much vertical space we have for the contact list
        var mainScreenRoot = document.getElementById('mainScreen');
        var collapsibleSections = findFirstByClass(document, 'collapsible-sections');
        var mainNavbar = findFirstByClass(mainScreenRoot, 'navbar');
        
        if (collapsibleSections && contactList) {
            var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            var sectionsRect = collapsibleSections.getBoundingClientRect();
            var navbarHeight = mainNavbar ? mainNavbar.offsetHeight : 44;

            // reserve a bit of space at the bottom so the rounded corners don't get cut off
            var bottomGutter = 10;
            var remainingHeight = viewportHeight - sectionsRect.bottom - bottomGutter;

            // on initial render, the layout might not be ready yet, so estimate instead
            if (remainingHeight < 120) {
                remainingHeight = viewportHeight - navbarHeight - collapsibleSections.offsetHeight - 30;
            }

            // enforce a minimum height so the list isn't tiny
            if (remainingHeight < 180) remainingHeight = 180;
            contactList.style.height = remainingHeight + 'px';
        }
    }
    
    // initialize the app state
    if (renderOwnProfile) renderOwnProfile();
    if (updateEditControls) updateEditControls();
    if (updateWindowTitle) updateWindowTitle();
    if (updateServiceFieldsVisibility) updateServiceFieldsVisibility();
    if (updateLoginButtonState) updateLoginButtonState();
    if (adjustContactListHeight) adjustContactListHeight();
    checkExistingSession();

    if (typeof setTimeout !== 'undefined') {
        // recalculate layout after a brief delay to ensure everything is rendered
        setTimeout(adjustContactListHeight, 50);
        setTimeout(adjustContactListHeight, 250);
    }
    
    // recalculate layout when screen is resized or rotated
    on(window, 'resize', adjustContactListHeight);
    on(window, 'orientationchange', adjustContactListHeight);
    on(window, 'load', adjustContactListHeight);
    
})();
