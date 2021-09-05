let express = require('express');
let expressW = require('express-ws');
let cpus = require('os').cpus;
let cluster = require("cluster");
let process = require("process");
let redis = require("async-redis").createClient();
let expressWs = expressW(express());
let app = expressWs.app;

const numCPUs = cpus().length;
process.on('uncaughtException', console.log);
if (cluster.isPrimary) {
	console.log(`Primary ${process.pid} is running`);

	// Fork workers.
	for (let i = 0; i < numCPUs; i++) {
	  cluster.fork();
	}

	cluster.on('exit', (worker, code, signal) => {
	  console.log(`worker ${worker.process.pid} died`);
	});
} else {
	app.get("/death", ()=>process.exit(0));
	app.get("/", (req, res) => res.end(`<html>
	<head>
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<script>
			let username = "";
			if(localStorage.getItem("username") != null) username = localStorage.getItem("username");
			while (username.replace(/[^a-z0-9]/gi,'') == "") username = prompt("Inserisci il tuo username");
			localStorage.setItem("username", username);
			let ws = new WebSocket('ws://'+window.location.host+'/w/'+username);
			ws.addEventListener('open', function (event) {
				window.inc = ()=>ws.send("+");
			});

			ws.addEventListener('message', function (event) {
				let data = JSON.parse(event.data);
				let i = [];
				let lock = false;
				data.forEach(param=>{
					if(!lock) i.push(param+": ");
					else i.push(param+"\\n");
					lock = !lock;
				});
				document.getElementById("area").innerText = i.join("");

			});
		</script>
	</head>
	<body>
		<center>
			<h1>contatore brutto</h1>
			<button onclick="inc()" style="width: 100; height: 100;">+</button>
			<h3>top punteggi:</h3>
			<pre id="area"></pre>
		</center>
	</body>
	</html>`));
	let cache = [];
	broadcast();
	let pending = {};
	let aWss = expressWs.getWss('/w/');
	app.ws('/w/:username', async function(ws, req) {
		try{
			let username = req.params.username.replace(/[^a-z0-9]/gi,'').toLowerCase().slice(0, 10);
			if(username == "") username = "nobody";
			ws.send(cache);
			ws.onmessage = async function(msg) {
				if(!pending[username]) pending[username] = 0;
				pending[username]++;
			};
		} catch(e) {}
	});

	async function broadcast(){
		return cache = JSON.stringify(await redis.zrevrange("scores", 0, 20, "WITHSCORES"));
	}
	setInterval(async ()=>{
		try{
			let current = redis.multi();
			Object.keys(pending).map(username=>current.zincrby("scores", pending[username], username));
			pending = {};
			await current.exec();
			await broadcast();
			aWss.clients.forEach(function (client) {
				client.send(cache);
			});
		} catch(e){console.log(e)}
	}, 70);
	app.listen(3444);
	console.log(`Worker ${process.pid} started`);
}
