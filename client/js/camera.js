
let predictionData = null; // FIXME hack

function camera_device_play_toggle(ws, ev)
{
	var sel = document.getElementById("camera_device_sel");
	var play = (ev.currentTarget.value == "Play");

	const msg_json = {
		"name" : play ? "camera-device-play" : "camera-device-stop",
		"value" : { "device": sel.value },
	};

	sel.disabled = play;

	ws.send(JSON.stringify(msg_json));

	// FIXME: bind this to server response
	ev.currentTarget.value = play ? "Stop" : "Play";
}

function camera_device_selection_change(ev)
{
	var play = document.getElementById("camera_device_play");
	play.disabled = (ev.currentTarget.value == "");
}

function camera_devices_get_request(ws)
{
	const msg_json = { "name" : "camera-devices-get" };
	ws.send(JSON.stringify(msg_json));
}

function camera_devices_get_response(ws, msg)
{
	var sel = document.getElementById("camera_device_sel");
	var play = document.getElementById("camera_device_play");

	play.disabled = true;

	if (!Array.isArray(msg) || msg.length == 0) {
		sel.innerHTML = '<option value="" hidden>No camera device...</option>';
		return;
	}

	var devices = [ "<option value='' selected>Select camera device...</option>" ];
	for (let dev of msg) {
		devices.push(`<option value="${dev.device}">${dev.card}</option>`);
	}

	// Register event listener when camera device changes
	sel.innerHTML = devices.join();
	sel.addEventListener('change', camera_device_selection_change);

	// Register event listener when the play button gets pushed
	play.addEventListener('click', function(ev) {
		camera_device_play_toggle(ws, ev);
	});
}

// adapted from: https://github.com/oatpp/example-yuv-websocket-stream/blob/master/res/cam/wsImageView.html
function yuv2CanvasImageData(canvas, data)
{
	let msg_array = new Uint8ClampedArray(data);

	if (msg_array.length == 0)
		return;

	let context = canvas.getContext("2d");
	let imgData = context.createImageData(640, 480);
	let i, j;

	for (i = 0, j = 0, g = 0; i < imgData.data.length && j < msg_array.length; i += 8, j += 4, g+= 2) {
		const y1 = msg_array[j  ];
		const u  = msg_array[j+1];
		const y2 = msg_array[j+2];
		const v  = msg_array[j+3];

		imgData.data[i    ] = Math.min(255, Math.max(0, Math.floor(y1+1.4075*(v-128))));
		imgData.data[i + 1] = Math.min(255, Math.max(0, Math.floor(y1-0.3455*(u-128)-(0.7169*(v-128)))));
		imgData.data[i + 2] = Math.min(255, Math.max(0, Math.floor(y1+1.7790*(u-128))));
		imgData.data[i + 3] = 255;
		imgData.data[i + 4] = Math.min(255, Math.max(0, Math.floor(y2+1.4075*(v-128))));
		imgData.data[i + 5] = Math.min(255, Math.max(0, Math.floor(y2-0.3455*(u-128)-(0.7169*(v-128)))));
		imgData.data[i + 6] = Math.min(255, Math.max(0, Math.floor(y2+1.7790*(u-128))));
		imgData.data[i + 7] = 255;
	}
	context.putImageData(imgData, 0, 0);
}

// FIXME: hack to do this quickly
function drpai_handle_object_detection_result(ws, msg)
{
	if (!Array.isArray(msg) || msg.length == 0) {
		predictionData = null;
		return;
	}

	predictionData = msg; // FIXME hack
}

function connect_camera_socket()
{
	let startTime = null;
	let updateElapsedTimeCounter = 0;
	const elapsedTimeFormat = { hour: "numeric", minute: "numeric", second: "numeric" };

	const callbacks = {
		"camera-devices-get": camera_devices_get_response,
		// FIXME: hack to do this quickly
		"drpai-object-detection-result": drpai_handle_object_detection_result,
	};

	function update_elapsed_time() {
		updateElapsedTimeCounter++;
		if (updateElapsedTimeCounter < 5)
			return;
		updateElapsedTimeCounter = 0;

		if (startTime == null)
			startTime = new Date();

		// VanillaJS way of formatting 00:00:00 time
		let nowTime = new Date();
		let elapsedTotal = Math.floor((nowTime - startTime) / 1000); // seconds
		let seconds = elapsedTotal % 60;
		elapsedTotal = Math.floor(elapsedTotal / 60);                // minutes
		let minutes = elapsedTotal % 60;
		let hours = Math.floor(elapsedTotal / 60);                   // hours
		let elem = document.getElementById("camera_elapsed_time");
		elem.innerHTML = hours.toString().padStart(2, '0') + ":" +
				 minutes.toString().padStart(2, '0') + ":" +
				 seconds.toString().padStart(2, '0');
	}

	function handle_binary_response(msg) {
		let canvas = document.getElementById("default_canvas");
		yuv2CanvasImageData(canvas, msg.data);
		update_elapsed_time();
	}

	let imgElem = document.createElement("img");
	function handle_binary_response2(msg) {
		let canvas = document.getElementById("default_canvas");
		let context = canvas.getContext("2d");

		let base64Image = btoa(String.fromCharCode.apply(null, new Uint8Array(msg.data)));

		imgElem.width = 640;
		imgElem.height = 480;
		imgElem.src = "data:image/jpeg;base64," + base64Image;

		context.drawImage(imgElem, 0, 0, 640, 480);
		if (predictionData) {
			var data = predictionData;
			context.linewidth = 16;
			context.strokeStyle = 'blue';
			context.fillStyle = 'blue';
			context.font = "24pt";
			for (i = 0; i < data.length; i++) {
				var label = data[i].label;
				var box = data[i].box;
				context.strokeRect(box.x, box.y, box.w, box.h);
				context.fillText(label, box.x, (box.y + 16));
			}
		}

		update_elapsed_time();
	}

	function handle_json_response(msg) {
		var msg = JSON.parse(msg.data);
		if (!Object.hasOwn(msg, 'name'))
			return;
		if (!Object.hasOwn(callbacks, msg.name))
			return;
		let cb = callbacks[msg.name];
		cb(ws, Object.hasOwn(msg, "value") ? msg.value : null);
	}

	let ws = new_ws("camera");
        ws.binaryType = "arraybuffer";
	try {
		ws.onopen = function() {
			camera_devices_get_request(ws);
		};

		ws.onmessage = function got_packet(msg) {
			if (msg.data instanceof ArrayBuffer) {
				handle_binary_response2(msg);
			} else {
				handle_json_response(msg);
			}
		};

		ws.onclose = function(){
		};

	} catch (exception) {

	}
}

connect_camera_socket();

