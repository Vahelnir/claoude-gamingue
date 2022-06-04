const game_id = +document
  .querySelector("meta[name='game_id']")
  .getAttribute("content");
const game_mount = document.getElementById("game_mount");

const protocol = location.protocol === "https" ? "wss" : "ws";
const websocket = new WebSocket(`${protocol}://${location.host}/ws`);
websocket.addEventListener("message", (message_event) => {
  const message = JSON.parse(message_event.data);
  console.log(message);

  if (message.name === "error") {
    // TODO: handle error
  } else if (message.name === "game:started") {
    stop_loading();
    const iframe = document.createElement("iframe");
    iframe.src = message.data.url;
    game_mount.appendChild(iframe);
  } else if (message.name === "game:starting") {
    start_loading();
  }
});

websocket.addEventListener("open", () => {
  console.log("ready");
  // start vm and wait, or wait for the one already being created
  websocket.send(JSON.stringify({ type: "game:start", data: { id: game_id } }));
  start_loop();
});

websocket.addEventListener("close", () => {
  console.log("closed");
  stop_loop();
});

websocket.addEventListener("error", (event) => console.log(event));

let last_input_time = Date.now();

function set_last_input_time() {
  last_input_time = Date.now();
}

document.addEventListener("keypress", set_last_input_time);
document.addEventListener("mousedown", set_last_input_time);

function send_ping() {
  console.log("ping");
  websocket.send(
    JSON.stringify({
      name: "ping",
      data: {
        time: Date.now(),
        has_focus: document.hasFocus(),
        last_input_time,
      },
    })
  );
}

let loop_interval_id;
function start_loop() {
  loop_interval_id = setInterval(send_ping, 5000);
}

function stop_loop() {
  clearInterval(loop_interval_id);
}

const loader_wrapper = document.querySelector(".loader_wrapper");
function start_loading() {
  loader_wrapper.classList.add("loader_wrapper--visible");
}

function stop_loading() {
  loader_wrapper.classList.remove("loader_wrapper--visible");
}
