/* eslint-disable no-undef */
let server = window.location.origin + "/";
let editors = {};
const templates = {};
const players = [];

templates.stream = `<% for(i = 0; i < devices.length; i++) { %>
  <tr data-index="<%=i%>" data-id="<%-devices[i].ID%>" data-template="stream">
    <td data-type="text" data-key="Name" data-value="<%-devices[i].Name%>"><%-devices[i].Name%></td>
	<td data-type="readonly" data-key="ID" data-value="<%-devices[i].ID%>"><%-devices[i].ID%></td>
	<td data-type="select" data-key="Type" data-value="<%-devices[i].Type%>" data-options="Select,Local Encoder,Homestudio SRT,Homestudio WebRTC"><%-devices[i].Type%></td>
	<td data-type="text" data-key="URL" data-value="<%-devices[i].URL%>"><%-devices[i].URL%></td>
	<td data-type="readonly" data-key="Encoder" data-value="<%-devices[i].Encoder%>">
		<% if (devices[i].Encoder !== undefined) { %>
			Address: <%-devices[i].Encoder.split('?streamid=')[0]%>
			<br />StreamID: <%-devices[i].Encoder.split('?streamid=')[1]%>
			<br />Mode: Caller
		<% } %>
	</td>
    <td>
      <button type="button" class="btn btn-danger editConfig w-50">Edit</button>
      <button type="button" class="btn btn-danger deleteRow w-50">Delete</button>
    </td>
  </tr>
<% } %>`;

function socketDoOpen(socket) {
	console.log('Registering as client');
	socket.send({'command':'register'});
	let to = new Date().getTime()/1000;
	let from = to - 7200;
}

function socketDoMessage(header, payload) {
	switch (payload.command) {
	case 'data':
		if (payload.system === currentSystem) {
			switch (payload.data) {
			case 'ping':
				if (payload.replace) {
					pingChart.data.datasets[0].data = payload.points;
				} else {
					const datePing = new Date(parseInt(payload.time));
					const colour = payload.status == 1 ? '128, 255, 128' : '255, 64, 64';
					pingChart.data.datasets[0].data[datePing] = payload.status;
					pingChart.data.datasets[0].backgroundColor[0] = `rgba(${colour}, 0.2)`;
					pingChart.data.datasets[0].borderColor[0] = `rgba(${colour}, 1)`;
				}
				lastPing = Date.now();
				pingChart.update();
				break;
			case 'boot':
				if (payload.replace) {
					bootChart.data.datasets[0].data = payload.points;
				} else {
					const dateBoot = new Date(parseInt(payload.time));
					bootChart.data.datasets[0].data[dateBoot] = 1;
				}
				lastBoot = Date.now();
				bootChart.update();
				break;
			case 'temps':
				if (payload.replace) {
					replaceTemps(payload.points);
				} else {
					addTemps(payload.points);
				}
				lastHot = Date.now();
				break;
			}
		}
		break;
	case 'log':
		switch (payload.type) {
		case 'ups':
			break;
		default:
			break;
		}
		break;
	case 'feeds':
		payload.feeds.forEach(feed => {
			$(`.feed-title[data-id="${feed.ID}"]`).html(feed.Name);
			$(`.sourceSelect[data-id="${feed.ID}"]`).data('name', feed.Name);
		});
		break;
	default:
		console.log('Unknown WS message');
		console.log(payload);
	}
}

function loading(state) {
	if (state) {
		$('#loading').removeClass('hidden');
	} else {
		$('#loading').addClass('hidden');
	}
}

$(document).ready(function() {
	const localConnection = new webSocket([`${window.location.hostname}:${window.location.port}`], 'Browser', version, currentSystem);
	localConnection.addEventListener('message', event => {
		const [header, payload] = event.detail;
		socketDoMessage(header, payload);
	});
	localConnection.addEventListener('open', () => {
		socketDoOpen(localConnection);
		$('#broken').html(`<span class="p-2 badge badge-pill bg-success">${currentSystem} Online</span>`);
	});
	localConnection.addEventListener('close', () => {
		$('#broken').html(`<span class="p-2 badge badge-pill bg-danger">${currentSystem} Offline</span>`);
	});

	renderStreams();

	$(document).click(function(e) {
		const $trg = $(e.target);
		const $one = $('#camOne');
		const $two = $('#camTwo');
		const $three = $('#camThree');
		const $four = $('#camFour');
		const $views = $('#views');
		if ($trg.is('#toggleConfig') || $trg.is('#closeConfig')) {
			if ($('#config').hasClass('hidden')) {
				loading(true);
				Promise.allSettled([
					getConfig('streams'),
				]).then(values => {
					const [streams] = values;
					loading(false);
					$('#config').removeClass('hidden');
					editors['streams'] = renderEditorTab(streams.value, editors['streams'], templates.stream, 'configStreams');
				}).catch(error => {
					console.error(error);
				});
			} else {
				$('#config').addClass('hidden');
			}
		} else if ($trg.hasClass('tableExport')) {
			const $table = $('table[data-editor="streams"]');
			const editor = $table.data('editor');
			const editorJSON = editors[editor].get();
			let csv = Object.keys(editorJSON[0]).join(',') + '\n';
			for (let index = 0; index < editorJSON.length; index++) {
				csv += Object.values(editorJSON[index]).join(',') + '\n';
			}
			download(`${editor}.csv`,csv);
		} else if ($trg.hasClass('tableImport')) {
			const $table = $('table[data-editor="streams"]');
			const $body = $table.find('tbody');
			const editor = $table.data('editor');
			const files = $('#csvUpload')[0].files;
			const reader = new FileReader();
			reader.onload = event => {
				const rows = event.target.result.split('\n');
				const headers = rows[0].split(',');
				const newEditor = []
				for (let index = 1; index < rows.length - 1; index++) {
					const row = rows[index].split(',');
					const item = {};
					for (let i = 0; i < headers.length; i++) {
						item[headers[i].replace('\r','')] = row[i].replace('\r','');
					}
					newEditor.push(item);
				}
				editors[editor].set(newEditor);
				editors[editor].expandAll();
				$body.html(ejs.render(templates[$body.data('template')], {devices: newEditor}));
			};
			reader.readAsText(files[0]);
		} else if ($trg.hasClass('toggleTableRaw')) {
			$('.dataTable').collapse('toggle');
			$('.dataRaw').collapse('toggle');
		} else if ($trg.hasClass('editConfig')) {
			let $row = $trg.closest('tr');
			$row.children().each(function() {
				let $td = $(this);
				switch ($td.data('type')) {
				case 'text': {
					let $txt = $(`<input type="text" class="form-control" value="${$td.data('value')}" name="${$td.data('key')}"></input>`);
					$txt.change(function() {
						$td.data('value', $txt.val());
					});
					$td.html('');
					$td.append($txt);
					break;
				}
				case 'range': {
					let $from = $(`<input type="text" class="editRange form-control text-end" value="${$td.data('from')}" name="${$td.data('key-from')}"></input>`);
					let $to = $(`<input type="text" class="editRange form-control" value="${$td.data('to')}" name="${$td.data('key-to')}"></input>`);
					$from.change(function() {
						$td.data('from', $from.val());
					});
					$to.change(function() {
						$td.data('to', $to.val());
					});
					$td.html('');
					$td.addClass('input-group');
					$td.append($from);
					$td.append('<span class="input-group-text">to</span>');
					$td.append($to);
					break;
				}
				case 'select': {
					let txt = `<select class="btn btn-outline-light" name="${$td.data('key')}">`;
					const options = $td.data('options').split(',');
					options.forEach(option => {
						const selected = option == $td.data('value') ? 'selected' : '';
						txt += `<option value="${option}" ${selected}>${option}</option>`;
					});
					txt += '</select>';
					const $txt = $(txt);
					$txt.change(function() {
						$td.data('value', $txt.val());
					});
					$td.html('');
					$td.append($txt);
					break;
				}
				case 'readonly': {
					break;
				}
				default:
					break;
				}
				$trg.html('Done');
				$trg.removeClass('editConfig');
				$trg.removeClass('btn-danger');
				$trg.addClass('doneConfig');
				$trg.addClass('btn-success');
			});
		} else if ($trg.hasClass('doneConfig')) {
			let $row = $trg.closest('tr');
			let data = {};
			$row.children().each(function() {
				let $td = $(this);
				let value = $td.data('value');
				switch ($td.data('type')) {
				case 'text':
					$td.html(value);
					data[$td.data('key')] = value;
					break;
				case 'range':
					$td.html(`${$td.data('from')} to ${$td.data('to')}`);
					data[$td.data('key-from')] = parseInt($td.data('from'));
					data[$td.data('key-to')] = parseInt($td.data('to'));
					$td.removeClass('input-group');
					break;
				case 'select':
					if (value == "") value = $td.children()[0].value
					$td.html(value);
					data[$td.data('key')] = value;
					break;
				case 'readonly':
					data[$td.data('key')] = value;
				default:
					break;
				}
				$trg.html('Edit');
				$trg.addClass('editConfig');
				$trg.addClass('btn-danger');
				$trg.removeClass('doneConfig');
				$trg.removeClass('btn-success');
			});
			let editor = $row.closest('table').data('editor');
			let current = editors[editor].get();
			current[$row.data('index')] = data;
			editors[editor].set(current);
			editors[editor].expandAll();
		} else if ($trg.hasClass('tableNew')) {
			const $tbody = $('table[data-editor="streams"]').find('tbody');
			const $rows = $tbody.children();
			let newID = 0;
			const IDs = [];
			console.log('here');
			$rows.each(function(){
				const row = $(this);
				newID = row.data('id') > newID ? row.data('id') : newID;
				IDs.push(row.data('id'));
			});
			newID++;
			for (let index = 1; index < newID; index++) {
				if (IDs.includes(index)) continue;
				newID = index;
				break;
			}
			const index = $rows.length;
			const template = $tbody.data('template');
			const dummyData = [];
			dummyData[0] = {};
			switch (template) {
			case 'stream':
				dummyData[0].Name = `Camera ${newID}`;
				dummyData[0].ID = newID;
				dummyData[0].Type = 'Select';
				dummyData[0].URL = '';
				break;
			default:
				break;
			}
			const $new = $(ejs.render(templates[template], {'devices': dummyData}));
			$new.attr('data-index', index);
			$new.attr('data-id', newID);
			$tbody.append($new);
			$new.find('.editConfig').trigger('click');
		} else if ($trg.hasClass('tableSave')) {
			let promises = [];
			for (const editor in editors) {
				if (Object.hasOwnProperty.call(editors, editor)) {
					promises.push($.ajax(`${server}set${editor}`, {
						data : JSON.stringify(editors[editor].get()),
						contentType : 'application/json',
						type : 'POST'}
					));
					streams = editors[editor].get();
					renderStreams();
				}
			}
			Promise.allSettled(promises).then(() => {
				alert('Saved');
			});
		} else if ($trg.hasClass('deleteRow')) {
			const $row = $trg.closest('tr');
			const $tbody = $trg.closest('tbody');
			const editor = $row.closest('table').data('editor');
			let current = editors[editor].get();
			current.splice($row.data('index'), 1);
			editors[editor].set(current);
			editors[editor].expandAll();
			$row.remove();
			
			$tbody.children().each(function(index) {
				$(this).attr('data-index', index);
			});
		} else if ($trg.is('#homestudioKeySet')) {
			localConnection.send({
				"command":"setKey",
				"key":$('#homestudioKey').val()
			});
		} else if ($trg.hasClass('sourceSelect')) {
			openPlayer($trg);
		} else if ($trg.is('#nav-one-tab')) {
			$two.addClass('d-none');
			$three.addClass('d-none');
			$four.addClass('d-none');
			$views.removeClass('masonry-2');
			$views.removeClass('triple');
			$views.addClass('masonry-1');
			$('.layout-btn.active').removeClass('active');
			$trg.addClass('active');
			$('.selectedPlayer').removeClass('selectedPlayer');
			$one.addClass('selectedPlayer');
			closePlayer($two.find('.player-container').children().first());
			closePlayer($three.find('.player-container').children().first());
			closePlayer($four.find('.player-container').children().first());
		} else if ($trg.is('#nav-two-tab')) {
			$two.removeClass('d-none');
			$three.addClass('d-none');
			$four.addClass('d-none');
			$views.addClass('masonry-2');
			$views.removeClass('triple');
			$views.removeClass('masonry-1');
			$('.layout-btn.active').removeClass('active');
			$trg.addClass('active');
			$('.selectedPlayer').removeClass('selectedPlayer');
			$two.addClass('selectedPlayer');
			closePlayer($three.find('.player-container').children().first());
			closePlayer($four.find('.player-container').children().first());
		} else if ($trg.is('#nav-three-tab')) {
			$two.removeClass('d-none');
			$three.removeClass('d-none');
			$four.addClass('d-none');
			$views.addClass('masonry-2');
			$views.addClass('triple');
			$views.removeClass('masonry-1');
			$('.layout-btn.active').removeClass('active');
			$trg.addClass('active');
			$('.selectedPlayer').removeClass('selectedPlayer');
			$three.addClass('selectedPlayer');
			closePlayer($four.find('.player-container').children().first());
		} else if ($trg.is('#nav-four-tab')) {
			$two.removeClass('d-none');
			$three.removeClass('d-none');
			$four.removeClass('d-none');
			$views.addClass('masonry-2');
			$views.removeClass('triple');
			$views.removeClass('masonry-1');
			$('.layout-btn.active').removeClass('active');
			$('.selectedPlayer').removeClass('selectedPlayer');
			$four.addClass('selectedPlayer');
			$trg.addClass('active');
		} else if ($trg.hasClass('closePlayer')) {
			closePlayer($trg.closest('.player-quad').find('.player-container').children().first());
			$('.selectedPlayer').removeClass('selectedPlayer');
			$trg.closest('.player-quad').addClass('selectedPlayer');
		} else if ($trg.hasClass('mutePlayer')) {
			const $player = $trg.closest('.player-quad').find('.player-container').children().first();
			$trg.toggleClass('muted');
			OvenPlayer.getPlayerByContainerId($player.attr('id')).setMute($trg.hasClass('muted'));
		} else if ($trg.hasClass('fullPlayer')) {
			$trg.closest('.player-quad').find('video')[0].requestFullscreen();
			console.log($trg.closest('.player-quad').find('video')[0]);
		} else if ($trg.hasClass('player-quad') || $trg.parents('.player-quad').length) {
			$('.selectedPlayer').removeClass('selectedPlayer');
			$trg.closest('.player-quad').addClass('selectedPlayer');
		} else if (!$trg.hasClass('player-quad') && !$trg.parents('.player-quad').length) {
			$('.selectedPlayer').removeClass('selectedPlayer');
		}
		players.forEach(player => player.play());
	});

	$(document).change(function(e) {
		const $trg = $(e.target);
		if ($trg.is('#csvUpload')) {
			$('.tableImport').attr('disabled',$trg.val()=='');
		} else if ($trg.is('select[name="Type"]')) {
			const newID = $trg.closest('tr').data('id');
			const $encoder = $trg.parent().siblings('[data-key="Encoder"]').first();
			const $urlTD = $trg.parent().siblings('[data-key="URL"]').first();
			const $url = $urlTD.children().first();
			if ($trg.val() == "Local Encoder") {
				$encoder.html(`Address: ${host}:9999/app
				<br />StreamID: srt://${host}:9999/app/feed${newID}
				<br />Mode: Caller`);
				$encoder.data('value', `${host}:9999/app?streamid=srt://${host}:9999/app/feed${newID}`);
				$url.val(`ws://${host}:3333/app/feed${newID}`);
				$urlTD.data('value', `ws://${host}:3333/app/feed${newID}`);
			} else {
				$encoder.html('');
			}
		}
	});

	setInterval(() => {
		for (thumb of document.getElementsByClassName('thumbnail')) {
			thumb.src = thumb.dataset.src + "?" + new Date().getTime();
		}
	}, 1000)
});

function openPlayer($element) {
	const streamURL = $element.data('url');
	const streamName = $element.data('name');
	const streamType = $element.data('type');
	const streamID = $element.data('id');
	const $player = $(`<div id="${streamName.replace(/ /g, '-')}-player" class="player-cont">`);
	let $selectedCont = $('.selectedPlayer .player-container');
	if ($selectedCont.length == 0) $selectedCont = $('#camOne .player-container');
	const $curentPlayer = $selectedCont.children().first();
	const $newPlayer = $(`#${streamName.replace(/ /g, '-')}-player`);
	if ($curentPlayer.length > 0) closePlayer($curentPlayer);
	if ($newPlayer.length > 0) closePlayer($newPlayer);

	$selectedCont.html($player);
	
	const $selectedTitle = $('.selectedPlayer .player-title');
	$selectedTitle.attr('data-id', streamID);
	$selectedTitle.html(streamName);

	switch (streamType) {
		case 'Local Encoder':
		case 'Homestudio WebRTC':				
			const player = OvenPlayer.create(`${streamName.replace(/ /g, '-')}-player`, {
				sources:[{
					label: streamName,
					type: 'webrtc',
					file: streamURL
				}],
				image: '/img/holding.png',
				autoStart: true,
				controls: false,
				disableSeekUI: true,
				showBigPlayButton: false,
				timecode: false,
				mute: true
			});
			players.push(player);
			player.play();
			player.on('stateChanged', data => {
				switch (data.newstate) {
					case 'error':
					case 'stalled':
					case 'idle':
						if (player.hasTimer) return
						player.hasTimer = true;
						player.timeout = setTimeout(() => {
							player.hasTimer = false;
							delete player.timeout;
							if (player.getState() === 'playing') return;
							player.load();
						}, 2000);
						break;
					case 'complete':
					case 'playing':
						player.hasTimer = false;
						clearTimeout(player.timeout);
						delete player.timeout;
						break;
					default:
						break;
				}
			})
			break;
		case 'Homestudio SRT':
			const options = {
				container: `${streamName.replace(/ /g, '-')}-player`,
				stream_url: streamURL + '?wmsAuthSign=' + homestudioKey,
				splash_screen: '/img/holding.png',
				width: 'parent',
				height: 'parent',
				muted: true,
				sync_buffer: 1000,
				buffering: 500,
				autoplay: true
			};
			SLDP.init(options);
			break;
		default:
			break;
	}
}

function closePlayer($element) {
	const $cont = $element.closest('.player-quad');
	const $title = $cont.find('.player-title');
	const title = $title.data('title');
	$title.html(title);
	$title.data('id', '');
	OvenPlayer.getPlayerByContainerId($element.attr('id')).remove();
	$element.remove();
}

function getConfig(catagory) {
	return $.getJSON(`${server}getConfig?catagory=${catagory}`);
}

function renderEditorTab(devicesData, editor, template, element) {
	if (!editor) {
		const container = document.getElementById(`${element}Raw`);
		let options = {
			'onChange': function() {
				$(`#${element}`).html(ejs.render(template, {devices: editor.get()}));
			},
			'mode': 'tree',
			'mainMenuBar': false,
			'navigationBar': false
		};
		editor = new JSONEditor(container, options);
	}
	editor.set(devicesData);
	editor.expandAll();
	$(`#${element}`).html(ejs.render(template, {devices: devicesData}));
	return editor;
}

function download(filename, text) {
	var element = document.createElement('a')
	element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text))
	element.setAttribute('download', filename)
	element.style.display = 'none'
	document.body.appendChild(element)
	element.click()
	document.body.removeChild(element)
}

function renderStreams() {
	$aside = $('#tumbList');
	$aside.html('');
	streams.forEach(stream => {
		$aside.append(`<div class="card text-white mb-2 sourceSelect"
		id="player-${stream.Name.replace(/ /g,'-')}-cont"
		data-id="${stream.ID}"
		data-url="${stream.URL}"
		data-name="${stream.Name}"
		data-type="${stream.Type}">
			<img class="thumbnail card-img-top"
				src="${stream.URL.replace('ws://', 'http://').replace('3333', '1935')}/thumb.jpg"
				data-src="${stream.URL.replace('ws://', 'http://').replace('3333', '1935')}/thumb.jpg"
				onerror="if (this.src != 'img/holding.png') this.src = 'img/holding.png';">
			<section class="py-1 px-2 playerTitle">
				<h5 class="card-title feed-title" data-id="${stream.ID}">${stream.Name}</h5>
			</section>
		</div>`);
	});
}


let beforeInstallPrompt = null;

window.addEventListener("beforeinstallprompt", eventHandler, errorHandler);

function eventHandler(event) {
  beforeInstallPrompt = event;
  document.getElementById("installBtn").classList.remove("d-none");
}

function errorHandler(event) {
  console.log("error: " + event);
}

function install() {
  if (beforeInstallPrompt) beforeInstallPrompt.prompt();
}