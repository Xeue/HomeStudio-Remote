/* eslint-disable no-undef */
let server = window.location.origin + "/";
let editors = {};
const templates = {};
const players = [];
let mapping = [
	1,
	0,
	0,
	0,
	0
];
let activeLayout = 0;

templates.encoder = `<% for(i = 0; i < devices.length; i++) { %>
  <tr data-index="<%=i%>" data-id="<%-devices[i].ID%>" data-template="encoder">
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

templates.decoder = `<% for(i = 0; i < devices.length; i++) { %>
	<tr data-index="<%=i%>" data-id="<%-devices[i].ID%>" data-template="decoder">
	  <td class="decodeStatus"></td>
	  <td data-type="text" data-key="Name" data-value="<%-devices[i].Name%>"><%-devices[i].Name%></td>
	  <td data-type="readonly" data-key="ID" data-value="<%-devices[i].ID%>"><%-devices[i].ID%></td>
	  <td data-type="text" data-key="URL" data-value="<%-devices[i].URL%>"><%-devices[i].URL%></td>
	  <td data-type="select" data-key="Feed" data-value="<%-devices[i].Feed%>" data-variable="encoders"><%-devices[i].Feed%></td>
	  <td class="d-flex gap-2">
	    <button type="button" class="btn btn-success startSRTPush flex-grow-1">Start</button>
		<button type="button" class="btn btn-success stopSRTPush flex-grow-1">Stop</button>
		<button type="button" class="btn btn-danger editConfig flex-grow-1">Edit</button>
		<button type="button" class="btn btn-danger deleteRow flex-grow-1">Delete</button>
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
		case 'decoding':
			$('#SRTPushStatus').html(payload.message);
			break;
		case 'pushStatus':
			if (payload.message.message !== "OK") break;
			$('#configDecoders tr').attr('class', '');
			payload.message.response.forEach(decode => {
				const $tr = $(`#configDecoders [data-id="${decode.id.replace('push_decoder_', '')}"`);
				$tr.addClass(decode.state);
			})
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
		if ($trg.is('#toggleConfig')) {
			if ($('#config').hasClass('hidden')) {
				loading(true);
				Promise.allSettled([
					getConfig('encoders'),
					getConfig('decoders'),
				]).then(values => {
					const [encoders, decoders] = values;
					loading(false);
					$('#config').removeClass('hidden');
					editors['encoders'] = renderEditorTab(encoders.value, editors['encoders'], templates.encoder, 'configEncoders');
					editors['decoders'] = renderEditorTab(decoders.value, editors['decoders'], templates.decoder, 'configDecoders');
				}).catch(error => {
					console.error(error);
				});
			} else {
				$('#config').addClass('hidden');
			}
		} else if ($trg.is('#layoutConfig')) {
			if ($('#layout').hasClass('hidden')) {
				loading(true);
				Promise.allSettled([
					getConfig('layouts')
				]).then(values => {
					const [layouts] = values;
					loading(false);
					console.log(layouts);
					$('#layout').removeClass('hidden');
				}).catch(error => {
					console.error(error);
				});
			} else {
				$('#layout').addClass('hidden');
			}
		} else if ($trg.is('#closeConfig')) {
			$('.popup').addClass('hidden');
		} else if ($trg.hasClass('tableExport')) {
			const $table = $('.tab-pane.active table[data-editor]');
			const editor = $table.data('editor');
			const editorJSON = editors[editor].get();
			let csv = Object.keys(editorJSON[0]).join(',') + '\n';
			for (let index = 0; index < editorJSON.length; index++) {
				csv += Object.values(editorJSON[index]).join(',') + '\n';
			}
			download(`${editor}.csv`,csv);
		} else if ($trg.hasClass('tableImport')) {
			const $table = $('.tab-pane.active table[data-editor]');
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
			const $active = $('.tab-pane.active');
			$active.find('.dataTable').collapse('toggle');
			$active.find('.dataRaw').collapse('toggle');
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
					if ($td.data('options')) {
						const options = $td.data('options').split(',');
						options.forEach(option => {
							const selected = option == $td.data('value') ? 'selected' : '';
							txt += `<option value="${option}" ${selected}>${option}</option>`;
						});
					} else {
						const variable = $td.data('variable');
						window[variable].forEach(data => {
							console.log(data);
							const selected = 'feed'+data.ID == $td.data('value') ? 'selected' : '';
							txt += `<option value="feed${data.ID}" ${selected}>${data.Name}</option>`;
						});
					}
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
			const $tbody = $('.tab-pane.active table[data-editor]').find('tbody');
			const $rows = $tbody.children();
			let newID = 0;
			const IDs = [];
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
			case 'encoder':
				dummyData[0].Name = `Camera ${newID}`;
				dummyData[0].ID = newID;
				dummyData[0].Type = 'Select';
				dummyData[0].URL = '';
				break;
			case 'decoder':
				dummyData[0].Name = `Decoder ${newID}`;
				dummyData[0].ID = newID;
				dummyData[0].Feed = 'Select';
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
				}
			}
			encoders = editors['encoders'].get();
			decoders = editors['decoders'].get();
			renderStreams();
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
			choseWindows(1);
		} else if ($trg.is('#nav-two-tab')) {
			choseWindows(2);
		} else if ($trg.is('#nav-three-tab')) {
			choseWindows(3);
		} else if ($trg.is('#nav-four-tab')) {
			choseWindows(4);
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
		} else if ($trg.hasClass('startSRTPush')) {
			const $tr = $trg.closest('tr');
			localConnection.send({
				"command":"startSRTPush",
				"id":$tr.data('id')
			});
		} else if ($trg.hasClass('stopSRTPush')) {
			const $tr = $trg.closest('tr');
			localConnection.send({
				"command":"stopSRTPush",
				"id":$tr.data('id')
			});
		} else if ($trg.hasClass('getSRTPush')) {
			const $tr = $trg.closest('tr');
			localConnection.send({
				"command":"getSRTPush",
				"id":$tr.data('id')
			});
		} else if ($trg.hasClass('pushAll')) {
			localConnection.send({
				"command":"startSRTAll"
			});
		} else if ($trg.hasClass('stopAll')) {
			localConnection.send({
				"command":"stopSRTAll"
			});
		} else if ($trg.hasClass('player-quad') || $trg.parents('.player-quad').length) {
			$('.selectedPlayer').removeClass('selectedPlayer');
			$trg.closest('.player-quad').addClass('selectedPlayer');
		} else if ($trg.hasClass('layoutSave')) {

		} else if ($trg.hasClass('addPip')) {
			
		} else if ($trg.hasClass('addLayout')) {
			
		} else if ($trg.hasClass('layoutConfigSelect')) {
			const layoutID = $trg.data('id');
			activeLayout = layoutID;
			drawConfigLayout();
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
		} else if ($trg.is('#layoutCols')) {
			const cols = Number($trg.val());
			layouts.filter(layout => layout.ID == activeLayout)[0].Columns = cols;
			drawConfigLayout();
		} else if ($trg.is('#layoutRows')) {
			const rows = Number($trg.val());
			layouts.filter(layout => layout.ID == activeLayout)[0].Rows = rows;
			drawConfigLayout();
		}
	});

	setInterval(() => {
		for (thumb of document.getElementsByClassName('thumbnail')) {
			thumb.src = thumb.dataset.src + "?" + new Date().getTime();
		}
	}, 1000)
});

function drawConfigLayout() {
	const thisLayout = layouts.filter(layout => layout.ID == activeLayout)[0];
	const $cont = $("#layoutGridCont");
	//const oldCols = $cont.attr("data-cols");
	//const oldRows = $cont.attr("data-rows");
	$cont.attr("data-cols", thisLayout.Columns);
	$cont.attr("data-rows", thisLayout.Rows);
	$('#layoutCols').val(thisLayout.Columns);
	$('#layoutRows').val(thisLayout.Rows);

	//if (oldRows < )

	$cont.html('');

	let pip = 1;
	for (let x = 1; x < (thisLayout.Rows)+1; x++) {
		for (let y = 1; y < (thisLayout.Columns)+1; y++) {
			$cont.append(`<div class="layoutPlaceholder"
			data-pip="${pip}"
			data-row-start="${x}"
			data-row-end="${x}"
			data-col-start="${y}"
			data-col-end="${y}"
			>
				<div class="layoutDragTop"></div>
				<div class="layoutDragLeft"></div>
				<div class="layoutDragBottom"></div>
				<div class="layoutDragRight"></div>
			</div>`);
			pip++;
		}
	}
};

function choseWindows(number) {
	mapping[0] = number;
	const $one = $('#camOne');
	const $two = $('#camTwo');
	const $three = $('#camThree');
	const $four = $('#camFour');
	const $views = $('#views');
	$('.selectedPlayer').removeClass('selectedPlayer');
	$('.layout-btn.active').removeClass('active');
	switch (number) {
		case 1:
			$two.addClass('d-none');
			$three.addClass('d-none');
			$four.addClass('d-none');
			$views.removeClass('masonry-2');
			$views.removeClass('triple');
			$views.addClass('masonry-1');
			$one.addClass('selectedPlayer');
			$('#nav-one-tab').addClass('active');
			closePlayer($two.find('.player-container').children().first());
			closePlayer($three.find('.player-container').children().first());
			closePlayer($four.find('.player-container').children().first());
			break;
		case 2:
			$two.removeClass('d-none');
			$three.addClass('d-none');
			$four.addClass('d-none');
			$views.addClass('masonry-2');
			$views.removeClass('triple');
			$views.removeClass('masonry-1');
			$two.addClass('selectedPlayer');
			$('#nav-two-tab').addClass('active');
			closePlayer($three.find('.player-container').children().first());
			closePlayer($four.find('.player-container').children().first());
			break;
		case 3:
			$two.removeClass('d-none');
			$three.removeClass('d-none');
			$four.addClass('d-none');
			$views.addClass('masonry-2');
			$views.addClass('triple');
			$views.removeClass('masonry-1');
			$three.addClass('selectedPlayer');
			$('#nav-three-tab').addClass('active');
			closePlayer($four.find('.player-container').children().first());
			break;
		case 4:
			$two.removeClass('d-none');
			$three.removeClass('d-none');
			$four.removeClass('d-none');
			$views.addClass('masonry-2');
			$views.removeClass('triple');
			$views.removeClass('masonry-1');
			$four.addClass('selectedPlayer');
			$('#nav-four-tab').addClass('active');
			break;
		default:
			break;
	}
	Cookies.set('mapping', JSON.stringify(mapping), {
		SameSite: 'Lax'
	});
}

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
	if ($newPlayer.length > 0 && !$curentPlayer.is($newPlayer)) closePlayer($newPlayer);

	$selectedCont.html($player);

	switch ($selectedCont.closest('.player-quad').data('type')) {
		case 'oneCam':
			mapping[1] = streamID;
			break;
		case 'twoCam':
			mapping[2] = streamID;
			break;
		case 'threeCam':
			mapping[3] = streamID;
			break;
		case 'fourCam':
			mapping[4] = streamID;
			break;
		default:
			break;
	}
	Cookies.set('mapping', JSON.stringify(mapping), {
		SameSite: 'Lax'
	});

	let $selectedTitle = $('.selectedPlayer .player-title');
	if ($selectedTitle.length == 0) $selectedTitle = $('#camOne .player-title');
	$selectedTitle.attr('data-id', streamID);
	$selectedTitle.html(streamName);

	switch (streamType) {
		case 'Local Encoder':
		case 'Homestudio WebRTC':
			let resolution = "";
			if (allowLowres && !$('#nav-one-tab').hasClass('active')) {
				resolution = "_lowres";
			}
			const player = OvenPlayer.create(`${streamName.replace(/ /g, '-')}-player`, {
				sources:[{
					label: streamName,
					type: 'webrtc',
					file: streamURL+resolution
				}],
				image: '/img/holding.png',
				autoStart: true,
				controls: true,
				disableSeekUI: true,
				showBigPlayButton: false,
				timecode: false,
				mute: true
			});
			players.push(player);
			player.play();
			player.on('stateChanged', data => {
				switch (data.newstate) {
					case 'playing':
						player.hasTimer = false;
						clearTimeout(player.timeout);
						delete player.timeout;
						break;
					default:
						if (player.hasTimer) return
						player.hasTimer = true;
						player.timeout = setTimeout(() => {
							player.hasTimer = false;
							delete player.timeout;
							if (player.getState() === 'playing') return;
							player.load();
						}, 1000 * reconnectTimeoutSeconds);
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
	try {
		const $cont = $element.closest('.player-quad');
		const $title = $cont.find('.player-title');
		const title = $title.data('title');
		$title.html(title);
		$title.data('id', '');
		OvenPlayer.getPlayerByContainerId($element.attr('id')).remove();
		$element.remove();
		switch ($cont.data('type')) {
			case 'oneCam':
				mapping[1] = 0;
				break;
			case 'twoCam':
				mapping[2] = 0;
				break;
			case 'threeCam':
				mapping[3] = 0;
				break;
			case 'fourCam':
				mapping[4] = 0;
				break;
			default:
				break;
		}
		Cookies.set('mapping', JSON.stringify(mapping), {
			SameSite: 'Lax'
		});
	} catch (error) {
		console.log('Issue closing player');
	}
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
	buildThumbnails();
	switch (layout) {
		case "basic":
			buildLayoutBasic();
			break;
		case "advanced":
			buildLayoutAdvanced();
			break;
		default:
			break;
	}
}

function buildThumbnails() {
	$aside = $('#tumbList');
	$aside.html('');
	encoders.forEach(encoder => {
		$aside.append(`<div class="card text-white mb-1 sourceSelect"
		id="player-${encoder.Name.replace(/ /g,'-')}-cont"
		data-id="${encoder.ID}"
		data-url="${encoder.URL}"
		data-name="${encoder.Name}"
		data-type="${encoder.Type}">
			<section class="playerTitle">
				<h5 class="card-title feed-title" data-id="${encoder.ID}">${encoder.Name}</h5>
			</section>
			<img class="thumbnail card-img-top"
				src="${encoder.URL.replace('ws://', 'http://').replace('3333', '1935')}/thumb.jpg"
				data-src="${encoder.URL.replace('ws://', 'http://').replace('3333', '1935')}/thumb.jpg"
				onerror="if (this.src != 'img/holding.png') this.src = 'img/holding.png';">
		</div>`);
	});
}

function buildLayoutBasic() {
	const mappingUnparsed = Cookies.get('mapping');
	if (mappingUnparsed !== undefined) {
		mapping = JSON.parse(mappingUnparsed);
		choseWindows(mapping[0]);
		for (let window = 1; window < mapping[0]+1; window++) {
			const source = mapping[window];
			if (source == 0) continue;
			$('.selectedPlayer').removeClass('selectedPlayer');
			switch (window) {
				case 1:
					$('#camOne').addClass('selectedPlayer')
					break;
				case 2:
					$('#camTwo').addClass('selectedPlayer')
					break;
				case 3:
					$('#camThree').addClass('selectedPlayer')
					break;
				case 4:
					$('#camFour').addClass('selectedPlayer')
					break;
				default:
					break;
			}
			openPlayer($(`.sourceSelect[data-id="${source}"]`));
			$('.selectedPlayer').removeClass('selectedPlayer');
		}
	}
}

function buildLayoutAdvanced() {
	console.log("WIP");
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











function getGridPosition(elem) {
    var gridContainer = elem.parent();
    var simpleEl = elem.get(0);
    var gridItems = gridContainer.children('div');
    const colCount = $(gridContainer).css('grid-template-columns').split(' ').length;

    var row = 0;
    var col = 0;

    gridItems.each(function(index,el) {

        var item = $(el);
        if(simpleEl==el) {
            //console.log("FOUND!")
            return false;
        }
        var gridCols = item.css("grid-column");
        if (gridCols != undefined && gridCols.indexOf("span") >=0 ) {
            var gridColumnParts = gridCols.split('/');
            var spanValue = parseInt(gridColumnParts[0].trim().split(' ')[1], 10);
            //console.log("spanValue: " + spanValue);
            col = col+spanValue;
        } else {
            col++;
        }
        if (col>=colCount) {
            col=0;
            row++;
        }
    });

    return {
        row: row,
        col: col
    };
}