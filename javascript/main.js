'use strict';


var server_instance                             = null;
var command_service                             = null;
var write_characteristic                        = null;
var write_client_evt_characteristic             = null;
var write_client_reqs_characteristic            = null;

var uart_rx_characteristic                      = null;

const MICROBIT_NAME_PREFIX                      = "BBC micro:bit";

var is_microbit_connected                       = false;
var bluetooth_device                            = null;
var busy                                        = false;

var command_queue                               = [];

const EVENT_SERVICE_UUID                        = "e95d93af-251d-470a-a062-fa1922dfa9a8";
const MICROBIT_EVENT_CHARACTERISTIC_UUID        = "e95d9775-251d-470a-a062-fa1922dfa9a8";
const CLIENT_EVENT_CHARACTERISTIC_UUID          = "e95d5404-251d-470a-a062-fa1922dfa9a8";
const CLIENT_REQUIREMENTS_CHARACTERISTIC_UUID   = "e95d23c4-251d-470a-a062-fa1922dfa9a8";

const UART_SERVICE_UUID                         = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_TX_CHARACTERISTIC_UUID               = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX_CHARACTERISTIC_UUID               = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

var music;
var music_alt;


function checkCurrentTime()
{
    var time_ok = false;

    // Official BIOTOB 2020 Date and Time:
    // Eastern Daylight Time August 08, 2020 12:00:00 UTC -4 (= EDT -4)
    var today = new Date();

    var utc_year = today.getUTCFullYear();
    var utc_month = today.getUTCMonth() + 1; // getUTCMonth values: 0 - 11
    var utc_date = today.getUTCDate();
    var utc_hours = today.getUTCHours();
    var utc_minutes = today.getUTCMinutes();

    // UTC -0 time = August 08, 2020 16:00:00
    console.log("> Time now in UTC = " + today.getUTCFullYear() + ", " + (today.getUTCMonth() + 1) + ", " + today.getUTCDate() + ", " + today.getUTCHours() + ", " + today.getUTCMinutes() + ", " + today.getUTCSeconds());

    if (utc_year > 2020)
    {
        //console.log("> Timer ok - year passed");

        time_ok = true;
    }
    else if (utc_month > 8)
    {
        //console.log("> Timer ok - month passed");

        time_ok = true;
    }
    else if (utc_date > 8)
    {
        //console.log("> Timer ok - date passed");

        time_ok = true;
    }
    else if (utc_hours >= 16)
    {
        //console.log("> Timer ok - hours passed");

        time_ok = true;
    }
    //else if (utc_minutes > 0)
    //{
    //    //console.log("> Timer ok - minutes passed");
    //
    //    time_ok = true;
    //}

    //console.log("> Timer ok? " + time_ok);

    return time_ok;
}



function initiateBluetoothConnection()
{
    //console.log("Initiate bluetooth connection");

    if (is_microbit_connected == false)
    {
        if (bluetooth_device == null)
        {
            // Request device
            requestBluetoothDevice();

            music = document.getElementById("biotob_music_a");
            music_alt = document.getElementById("biotob_music_b");
        }
        else
        {
            connectToBluetoothDevice( bluetooth_device );
        }
    }
}



function requestBluetoothDevice()
{
    console.log("> Requesting bluetooth device...");

    return navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        //filters: [
            //{namePrefix: MICROBIT_NAME_PREFIX}

        //],
        optionalServices: [ EVENT_SERVICE_UUID, UART_SERVICE_UUID ]
    })
    .then(device => {

        console.log('> "' + device.name + '" bluetooth device found');

        bluetooth_device = device;

        //cacheRequestedBluetoohDevice( device );

        device.addEventListener('gattserverdisconnected', handleBluetoothDisconnection);

        connectToBluetoothDevice( device );
    })
    .catch(error => { console.log( "> Device request error: " + error ); });
}


function connectToBluetoothDevice( device )
{
    console.log("> Connecting to bluetooth device: " + device.name);

    //if (device == null)
    //{
    //   return;
    //}

    // Attempts to connect to remote GATT Server
    // to get access to the services and characteristics of the device
    device.gatt.connect()
    .then(server => {
        // Get a primary GATT service
        console.log("> Get primary GATT service");

        server_instance = server;

        return server.getPrimaryService( EVENT_SERVICE_UUID );
    })
    .then(service => {
        //  Read the GATT service's Microbit Event characteristics.
        console.log("> Found command service");

        command_service = service;

        return command_service.getCharacteristic( MICROBIT_EVENT_CHARACTERISTIC_UUID );
    })
    .then(characteristic => {
        console.log("> Found write characteristic");

        write_characteristic = characteristic;
        write_characteristic.startNotifications();
        write_characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);

        return command_service.getCharacteristic( CLIENT_EVENT_CHARACTERISTIC_UUID );
    })
    .then(client_evt_characteristic => {
    	console.log("> Found client event characteristic");

    	write_client_evt_characteristic = client_evt_characteristic;

    	return command_service.getCharacteristic( CLIENT_REQUIREMENTS_CHARACTERISTIC_UUID );
    })
    .then(client_reqs_characteristic => {
    	console.log("> Found client requirement characteristic");

    	write_client_reqs_characteristic = client_reqs_characteristic;

    	initEvent();
    })
    .then(_ => {
        return server_instance.getPrimaryService( UART_SERVICE_UUID )
        .then(newService => {
            //  Read the UART service's TX characteristics.
            console.log("> Get reading characteristic");

            return newService.getCharacteristic( UART_TX_CHARACTERISTIC_UUID );
        })
        .then(tx_char => {
            tx_char.startNotifications().then(res => {
                tx_char.addEventListener('characteristicvaluechanged', handleMicrobitDataChanged);
            })
        })
        .then(rx_char => {
        	console.log("> Found uart writing characteristic");

        	uart_rx_characteristic = rx_char;
        })
    })
    .catch(error => { console.log( "> Connection error: " + error ); });
}


function handleCharacteristicValueChanged( event )
{
    //console.log("> Handle characteristic value changed");

    var value = event.target.value;

    var arr = [];

    // Convert raw data bytes to hex values just for the sake of showing something.
    // In the "real" world, you'd use data.getUint8, data.getUint16 or even
    // TextDecoder to process raw data bytes.
    for (var i = 0; i < value.byteLength; i++)
    {
        arr.push('0x' + ('00' + value.getUint8(i).toString(16)).slice(-2));
    }

    //console.log("> " + arr.join(" "));
}



function handleMicrobitDataChanged( event )
{
    //console.log("> Handle microbit data changed");

    var value = event.target.value;

    var data = new TextDecoder().decode(value);

    console.log("> " + data + " button clicked");

    if (data == "A")
    {
        if (checkCurrentTime())
        {
            sendCommandToDevice("ok~");
            music.play();
        }
        else
        {
            sendCommandToDevice("wait|");
            music_alt.play();
        }
    }
    else if (data == "B")
    {
        music.pause();
        music_alt.pause();
    }
}



function initEvent()
{
    var cmd = new Uint16Array([0x2274, 0x00]);

    sendEvent(cmd)
    .then(() => {
        console.log("> Event initialized");
    })
    .catch(error => {
        console.log( "> Error initializing event: " + error );

        //handleInitEventError();
    });
}


function handleInitEventError()
{
    resetVariables();
}




// Reset app variables
function resetVariables()
{
    busy = false;

    server_instance = null;
    command_service = null;
    write_characteristic = null;
    write_client_evt_characteristic = null;
    write_client_reqs_characteristic = null;
    uart_rx_characteristic = null;
}



function sendEvent( command )
{
    if (write_client_reqs_characteristic)
    {
        // Handle one command at a time
        if (busy)
        {
            // Queue commands
            command_queue.push( command );

            return;// Promise.resolve();
        }

        busy = true;

        return write_client_reqs_characteristic.writeValue( command ).then(() => {
            busy = false;

            // Get next command from queue
            var next_command = command_queue.shift();

            if (next_command)
            {
                sendEvent(next_command);
            }
        });
    }
    else
    {
        return;// Promise.resolve();
    }
}




function handleBluetoothDisconnection( event )
{
    //let device = event.target;

    if (bluetooth_device == null)
    {
        //bluetooth_device = event.target;
    }

    console.log("> " + bluetooth_device.name + " disconnected...");

    // Attempt to reconnect
    //connectToBluetoothDevice( event.target );
}



function sendCommandToDevice( input )
{
    var bytes = []; // char codes
	var sbyte;

	var cmd = input;
	var final_cmd;
    var code;

    for (var i = 0; i < cmd.length; ++i)
    {
    	code = cmd.charCodeAt(i);
      	bytes = bytes.concat([ code ]);
    }

    for (var j = 0; j < bytes.length; j++)
    {
    	sbyte = bytes[j];

    	//console.log(sbyte);

      	final_cmd = new Uint16Array([0x2274, sbyte]);

      	writeCommand( final_cmd );
    }
}



function writeCommand( command )
{
    if (write_client_evt_characteristic)
    {
        // Handle one command at a time
        if (busy)
        {
            // Queue commands
            command_queue.push( command );

            return;// Promise.resolve();
        }

        busy = true;


        return write_client_evt_characteristic.writeValue( command ).then(() => {
            busy = false;

            // Get next command from queue
            var next_command = command_queue.shift();

            if (next_command)
            {
                writeCommand( next_command );
            }
        });
    }
    else
    {
        return;// Promise.resolve();
    }
}




function writeCommandToDevice( command )
{
    if (uart_rx_characteristic)
    {
        // Handle one command at a time
        if (busy)
        {
            // Queue commands
            command_queue.push( command );

            return;// Promise.resolve();
        }

        busy = true;


        return uart_rx_characteristic.writeValue( command ).then(() => {
            busy = false;

            // Get next command from queue
            var next_command = command_queue.shift();

            if (next_command)
            {
                writeCommandToDevice( next_command );
            }
        });
    }
    else
    {
        return;// Promise.resolve();
    }
}
