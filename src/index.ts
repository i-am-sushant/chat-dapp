import Peer from 'peerjs';
import $ from 'jquery';

// On document load
$(document).ready(function () {
    let peer: Peer = null;
    let last_peer: string = null;
    let conn: Peer.DataConnection = null;

    // Variables for file sharing
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    const sendFileButton = document.getElementById('sendFileButton') as HTMLButtonElement;
    const receivedFilesDiv = document.getElementById('receivedFilesArea') as HTMLDivElement;

    let receivingFileChunks: { [fileName: string]: ArrayBuffer[] } = {};
    let receivingFileMetadata: { [fileName: string]: { name: string, type: string, size: number } } = {};

    // Create message object
    function createMessage(content: string): object {
        return {author: peer.id, timestamp: new Date().getTime(), content: content};
    }

    // Create room object
    function createRoom(): object {
        return {self: peer.id, peer: conn.peer, messages: {}};
    }

    // Set status
    function setStatus(status: string, newColor: string) {
        $('#status').text(status);
        const colors = ['green', 'yellow', 'red'];
        colors.forEach(function (item) {
            if (newColor === item) {
                $('#status-icon').addClass(item + '-color');
            } else {
                $('#status-icon').removeClass(item + '-color');
            }
        });
    }

    // Get timestamp
    function getTimestamp(ms: number): string {
        function addZero(t: number): string {
            let res: string;
            if (t < 10) {
                res = '0' + t;
            } else {
                res = t.toString();
            }
            return res;
        }

        const parsed_date = new Date(ms);
        const h: number = parsed_date.getHours();
        const m: number = parsed_date.getMinutes();
        const s: number = parsed_date.getSeconds();

        let h_res: string;
        if (h > 12) {
            h_res = (h - 12).toString();
        } else if (h === 0) {
            h_res = (12).toString();
        } else {
            h_res = h.toString();
        }

        return h_res + ':' + addZero(m) + ':' + addZero(s);
    }

    // Function to create download links for received files
    function createDownloadLink(blob: Blob, fileName: string) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.textContent = `Download ${fileName}`;
        a.style.display = 'block';
        receivedFilesDiv.appendChild(a);
    }

    // Function to send file in chunks
    async function sendFileInChunks(file: File, currentConnection: Peer.DataConnection) {
        if (!currentConnection || !currentConnection.open) {
            addMessage(createMessage('System: Not connected to a peer to send file.'));
            return;
        }
        addMessage(createMessage(`System: Preparing to send file: ${file.name}`));

        const metadata = {
            type: 'file-metadata',
            name: file.name,
            size: file.size,
            fileType: file.type,
        };
        currentConnection.send(metadata);
        addMessage(createMessage(`System: Sent metadata for ${file.name}`));

        const chunkSize = 16 * 1024;
        let offset = 0;
        const reader = new FileReader();

        function readNextChunk() {
            const slice = file.slice(offset, offset + chunkSize);
            reader.readAsArrayBuffer(slice);
        }

        reader.onload = (event) => {
            if (event.target && event.target.result) {
                currentConnection.send({
                    type: 'file-chunk',
                    name: file.name,
                    data: event.target.result,
                    offset: offset
                });
                offset += (event.target.result as ArrayBuffer).byteLength;

                if (offset < file.size) {
                    setTimeout(readNextChunk, 50);
                } else {
                    currentConnection.send({ type: 'file-end', name: file.name });
                    addMessage(createMessage(`System: Finished sending ${file.name}`));
                }
            } else {
                addMessage(createMessage(`System: Error reading file chunk for ${file.name}`));
            }
        };

        reader.onerror = () => {
            addMessage(createMessage(`System: Error reading file ${file.name}: ${reader.error}`));
        };

        readNextChunk();
    }

    // Reconnect button
    $('#reconnectButton').click(function () {
        initialize();
    });

    // Setup Peer connection
    function initialize() {
        // Create own Peer connection
        peer = new Peer();

        // On Peer open
        peer.on('open', function (_: string) {
            // Detect if Peer id is defined
            if (peer.id === null) {
                console.log('Received null id from Peer connection');
                peer.id = last_peer;
            } else {
                last_peer = peer.id;
            }

            // Display Peer id
            $('#uid').val(peer.id);
        });

        // On Peer connection
        peer.on('connection', function (c: Peer.DataConnection) {
            // Allow only a single connection for now
            if (conn) {
                c.on('open', function () {
                    alert('Already connected to another client');
                    setTimeout(function () {
                        c.close();
                    }, 500);
                });
                return;
            }

            // Save connection
            conn = c;

            // Get connection ready
            ready();
        });

        // On Peer disconnection
        peer.on('disconnected', function () {
            // Change status
            setStatus('Disconnected', 'yellow');

            // Attempt to reconnect
            peer.id = last_peer;
            peer.reconnect();
        });

        peer.on('close', function () {
            // Prompt refresh
            conn = null;
            setStatus('Client closed (Please refresh)', 'red');
        });

        peer.on('error', function (err: any) {
            console.log(err);
            alert('' + err);

            // TODO: Handle all errors
            switch (err.type) {
                case 'peer-unavailable':
                    setStatus('Disconnected', 'yellow');
            }
        });
    }

    // Call when Peer connection is established
    function ready() {
        conn.on('open', function () {
            // Change status and set RID
            setStatus('Connected', 'green');
            $('#rid').val(conn.peer);
        });

        conn.on('data', function (data: any) {
            if (data && data.type) {
                switch (data.type) {
                    case 'file-metadata':
                        addMessage(createMessage(`System: Receiving metadata for file: ${data.name} (${data.size} bytes)`));
                        receivingFileMetadata[data.name] = { name: data.name, type: data.fileType, size: data.size };
                        receivingFileChunks[data.name] = [];
                        const progressPlaceholder = document.createElement('p');
                        progressPlaceholder.id = `progress-${data.name.replace(/\W/g, '_')}`;
                        progressPlaceholder.textContent = `Receiving ${data.name}: 0%`;
                        receivedFilesDiv.appendChild(progressPlaceholder);
                        break;
                    case 'file-chunk':
                        if (receivingFileMetadata[data.name] && receivingFileChunks[data.name]) {
                            receivingFileChunks[data.name].push(data.data);
                            let receivedSize = receivingFileChunks[data.name].reduce((acc, chunk) => acc + chunk.byteLength, 0);
                            const progress = Math.min(100, Math.round((receivedSize / receivingFileMetadata[data.name].size) * 100));
                            
                            const currentProgressP = document.getElementById(`progress-${data.name.replace(/\W/g, '_')}`);
                            if (currentProgressP) {
                                currentProgressP.textContent = `Receiving ${data.name}: ${progress}%`;
                            }
                        } else {
                            addMessage(createMessage(`System: Received chunk for unknown file: ${data.name}`));
                        }
                        break;
                    case 'file-end':
                        if (receivingFileMetadata[data.name] && receivingFileChunks[data.name]) {
                            addMessage(createMessage(`System: File transfer complete for: ${data.name}`));
                            const fileBlob = new Blob(receivingFileChunks[data.name], { type: receivingFileMetadata[data.name].type });
                            createDownloadLink(fileBlob, receivingFileMetadata[data.name].name);
                            
                            const endProgressP = document.getElementById(`progress-${data.name.replace(/\W/g, '_')}`);
                            if (endProgressP) {
                                endProgressP.textContent = `Received ${data.name} - Complete.`;
                            }
                            delete receivingFileChunks[data.name];
                            delete receivingFileMetadata[data.name];
                        } else {
                             addMessage(createMessage(`System: Received file-end for unknown file: ${data.name}`));
                        }
                        break;
                    default:
                        if (data.author && data.content) {
                           addMessage(data);
                        } else {
                           addMessage(createMessage(`System: Received unknown structured data: ${JSON.stringify(data)}`));
                        }
                }
            } else if (data.author && data.content) {
                 addMessage(data);
            } else {
                addMessage(createMessage(`Peer: ${JSON.stringify(data)}`));
            }
        });

        conn.on('close', function () {
            conn = null;
            setStatus('Connection closed', 'yellow');
        });
    }

    // Add message to html
    function addMessage(msg: any) {
        let authorSpan: string;
        switch (msg.author) {
            case peer.id:
                authorSpan = '<span class=\"red-color\"> - ' + msg.author + ' : </span>';
                break;
            default:
                authorSpan = '<span class=\"green-color\"> - ' + msg.author + ' : </span>';
                break;
        }

        $('#messageBox').append('<p><span class=\"blue-color\">' + getTimestamp(msg.timestamp) + '</span>' + authorSpan + '<span>' + msg.content + '</span></p>');
        $('#messageContainer').animate({
            scrollTop: $('#messageContainer').prop('scrollHeight')
        }, 0);
    }

    // Click button from enter key press on text box
    $('#rid').keypress(function (e) {
        if (e.which === 13) {
            $('#rid-button').click();
            return false;
        }
    });

    // Connect via RID
    $('#rid-button').click(function () {
        // Close current connection
        if (conn) {
            conn.close();
        }

        // Connect to RID
        conn = peer.connect($('#rid').val().toString(), {
            reliable: true
        });

        ready();
    });

    // Click button from enter key press on text box
    $('#messageText').keypress(function (e) {
        if (e.which === 13) {
            $('#messageSend').click();
            return false;
        }
    });

    // Send message
    $('#messageSend').click(function () {
        const text = $('#messageText').val().toString();
        if (text === '') {
            return;
        }

        let msg: object = createMessage(text);

        if (conn && conn.open) {
            conn.send(msg);
            addMessage(msg);
        }

        $('#messageText').val('');
    });

    // Add event listener for the send file button
    if (sendFileButton) {
        sendFileButton.onclick = () => {
            if (fileInput.files && fileInput.files.length > 0) {
                const file = fileInput.files[0];
                if (conn && conn.open) {
                    sendFileInChunks(file, conn);
                } else {
                    addMessage(createMessage('System: Not connected to a peer. Cannot send file.'));
                }
            } else {
                addMessage(createMessage('System: No file selected.'));
            }
        };
    }

    initialize();
});