/* eslint-disable no-undef */
let server = window.location.origin + "/";
let editors = {};
const templates = {};
const players = [];

templates.stream = `<% for(i = 0; i < devices.length; i++) { %>
  <tr data-index="<%=i%>" data-template="stream">
    <td data-type="text" data-key="Name" data-value="<%-devices[i].Name%>"><%-devices[i].Name%></td>
	<td data-type="select" data-key="Type" data-value="<%-devices[i].Type%>" data-options="Select,Local Encoder,Homestudio SRT,Homestudio WebRTC"><%-devices[i].Type%></td>
	<td data-type="text" data-key="URL" data-value="<%-devices[i].URL%>"><%-devices[i].URL%></td>
	<td data-type="readonly" data-key="Encoder" data-value="<%-devices[i].Encoder%>">
		<% if (devices[i].Encoder !== undefined) { %>
			URL: <%-devices[i].Encoder%>
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
	default:

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
		$('#broken').html('<span class="p-2 badge badge-pill bg-success">Home Studio Online</span>');
	});
	localConnection.addEventListener('close', () => {
		$('#broken').html('<span class="p-2 badge badge-pill bg-danger">Home Studio Offline</span>');
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
			const index = $rows.length;
			const template = $tbody.data('template');
			const dummyData = [];
			dummyData[0] = {};
			switch (template) {
			case 'stream':
				dummyData[0].Name = `Camera ${index+1}`;
				dummyData[0].Type = 'Select';
				dummyData[0].URL = '';
				break;
			default:
				break;
			}
			const $new = $(ejs.render(templates[template], {'devices': dummyData}));
			$new.attr('data-index', index);
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
			$views.addClass('masonry-1');
			$('.layout-btn.active').removeClass('active');
			$trg.addClass('active');
			$('.selectedPlayer').removeClass('selectedPlayer');
			$one.addClass('selectedPlayer');
			closePlayer($two);
			closePlayer($three);
			closePlayer($four);
		} else if ($trg.is('#nav-two-tab')) {
			$two.removeClass('d-none');
			$three.addClass('d-none');
			$four.addClass('d-none');
			$views.addClass('masonry-2');
			$views.removeClass('masonry-1');
			$('.layout-btn.active').removeClass('active');
			$trg.addClass('active');
			$('.selectedPlayer').removeClass('selectedPlayer');
			$two.addClass('selectedPlayer');
			closePlayer($three);
			closePlayer($four);
		} else if ($trg.is('#nav-four-tab')) {
			$two.removeClass('d-none');
			$three.removeClass('d-none');
			$four.removeClass('d-none');
			$views.addClass('masonry-2');
			$views.removeClass('masonry-1');
			$('.layout-btn.active').removeClass('active');
			$('.selectedPlayer').removeClass('selectedPlayer');
			$three.addClass('selectedPlayer');
			$trg.addClass('active');
		} else if ($trg.hasClass('closePlayer')) {
			closePlayer($trg.closest('.player-quad'));
			$('.selectedPlayer').removeClass('selectedPlayer');
			$trg.closest('.player-quad').addClass('selectedPlayer');
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
			const index = $trg.closest('tr').data('index');
			const $encoder = $trg.parent().siblings('[data-key="Encoder"]').first();
			const $urlTD = $trg.parent().siblings('[data-key="URL"]').first();
			const $url = $urlTD.children().first();
			if ($trg.val() == "Local Encoder") {
				$encoder.html(`URL: srt://${host}:9999/app?streamid=srt://${host}:9999/app/feed${index+1}
				<br />Mode: Caller`);
				$encoder.data('value', `srt://${host}:9999/app?streamid=srt://${host}:9999/app/feed${index+1}`);
				$url.val(`ws://${host}:3333/app/feed${index+1}`);
				$urlTD.data('value', `ws://${host}:3333/app/feed${index+1}`);
			} else {
				$encoder.html('');
			}
		}
	});
});

function openPlayer($element) {
	const $title = $element.find('.card-title').html();
	const $player = $element.children('div')[0];
	const $cont = $('.selectedPlayer .player-container');
	const $current = $cont.children().first();
	if ($current.length > 0) {
		$(`#${$current.attr('id')}-cont`).prepend($current);
		$(`#${$current.attr('id')}-cont`).removeClass('d-none');
	}
	$cont.append($player);
	$('.selectedPlayer .player-title').html($title);
	$element.addClass('d-none');
}

function closePlayer($element) {
	const title = $element.find('.player-title').data('title');
	const $player = $element.find('.player-container').children().first();
	const playerID = $player.attr('id');
	const $orig = $('#'+playerID+"-cont");
	$orig.prepend($player);
	$orig.removeClass('d-none');
	$element.find('.player-title').html(title);
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
		$aside.append(`<div class="card text-white mb-2 sourceSelect" id="player-${stream.Name.replace(/ /g,'-')}-cont">
			<div class="thumbnail card-img-top" id="player-${stream.Name.replace(/ /g,'-')}">
			</div>
			<section class="py-1 px-2 playerTitle">
				<h5 class="card-title">${stream.Name}</h5>
			</section>
		</div>`);
		let player;
		switch (stream.Type) {
			case 'Local Encoder':
			case 'Homestudio WebRTC':				
				player = OvenPlayer.create('player-'+stream.Name.replace(/ /g,'-'), {
					sources:[{
						label: stream.Name,
						type: 'webrtc',
						file: stream.URL
					}],
					image: '/img/holding.png',
					autoStart: true,
					controls: false,
					disableSeekUI: true,
					showBigPlayButton: false,
					timecode: false
				});
				players.push(player);
				player.play();
				break;
			case 'Homestudio SRT':
				const options = {
					container: 'player-'+stream.Name.replace(/ /g,'-'),
					stream_url: stream.URL + '?wmsAuthSign=' + homestudioKey,
					splash_screen: '/img/holding.png',
					width: 'parent',
					height: 'parent',
					muted: false,
					sync_buffer: 1000,
					buffering: 500,
					autoplay: true
				};
				console.log(options)
				SLDP.init(options);
				break;
			default:
				break;
		}
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