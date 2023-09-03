/* eslint-disable no-undef */
const prod = true;
let server = window.location.origin + "/";
let editors = {};
const templates = {};
const players = [];
let mapping = [];
let activeLayout = 1;

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

layoutDragTemplate = `<div class="layoutPlaceholder layoutPip"
data-pip="<%-pip.id%>"
data-row-start="<%-pip.rowStart%>"
data-row-end="<%-pip.rowEnd%>"
data-col-start="<%-pip.colStart%>"
data-col-end="<%-pip.colEnd%>"
>
	<div class="layoutDrag layoutDragT"></div>
	<div class="layoutDrag layoutDragL"></div>
	<div class="layoutDrag layoutDragB"></div>
	<div class="layoutDrag layoutDragR"></div>
	<div class="layoutDrag layoutDragTL"></div>
	<div class="layoutDrag layoutDragTR"></div>
	<div class="layoutDrag layoutDragBL"></div>
	<div class="layoutDrag layoutDragBR"></div>
</div>`

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
	case 'layouts':
		layouts = payload.layouts;
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

	const layoutUnparsed = Cookies.get('activeLayout');
	if (layoutUnparsed !== undefined) {
		setActiveLayout(JSON.parse(layoutUnparsed));
	}

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
				getConfig('layouts').then(values => {
					layouts = values;
					loading(false);
					drawAdvancedLayoutSelect();
					$('#layout').removeClass('hidden');
				}).catch(error => {
					console.error(error);
				});
			} else {
				$('#layout').addClass('hidden');
			}
		} else if ($trg.is('#closeConfig')) {
			$('.popup').addClass('hidden');
		} else if ($trg.is('#fullscreen')) {
			$('body').toggleClass('fullscreen');
			const body = document.getElementsByTagName("body")[0];
			body.requestFullscreen();
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
			configRowEdit($trg);
		} else if ($trg.hasClass('doneConfig')) {
			configRowDone($trg);
		} else if ($trg.hasClass('tableNew')) {
			configRowAdd();
		} else if ($trg.hasClass('tableSave')) {
			configSave();
		} else if ($trg.hasClass('deleteRow')) {
			configRowDelete($trg);
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
		} else if ($trg.hasClass('layout-btn')) {
			setActiveLayout($trg.attr('data-id'));
			buildLayoutAdvanced();
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
			layoutSave();
		} else if ($trg.hasClass('addLayout')) {
			const newID = layouts.length+1;
			layouts.push({
				"Name": "New Layout",
				"ID": newID,
				"Columns": 2,
				"Rows": 2,
				"Pips": {
				  "1": {
					"rowStart": 1,
					"rowEnd": 1,
					"colStart": 1,
					"colEnd": 1
				  },
				  "2": {
					"rowStart": 2,
					"rowEnd": 2,
					"colStart": 1,
					"colEnd": 1
				  },
				  "3": {
					"rowStart": 1,
					"rowEnd": 1,
					"colStart": 2,
					"colEnd": 2
				  },
				  "4": {
					"rowStart": 2,
					"rowEnd": 2,
					"colStart": 2,
					"colEnd": 2
				  }
				},
				"Mapping": {}
			});
			setActiveLayout(newID);
			drawAdvancedLayoutSelect();
		} else if ($trg.hasClass('renameLayout')) {
			const $btn = $('.layoutConfigSelect.active');
			const text = $btn.html();
			$btn.html(`<form class="renameForm" action="#">
				<input class="renameLayoutInput" value="${text}"/>
				<input type="submit" style="display:none" value="">
			</form>`)
			$('.renameLayoutInput').focus();
		} else if ($trg.hasClass('layoutConfigSelect')) {
			setActiveLayout($trg.data('id'));
			drawConfigLayout();
		} else if ($trg.is('#thumbclear')) {
			$('.sourceSelect').removeClass('d-none');
			$('#thumbinput').val('');
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
			getActiveLayout().Columns = cols;
			updateConfigLayout();
		} else if ($trg.is('#layoutRows')) {
			const rows = Number($trg.val());
			getActiveLayout().Rows = rows;
			updateConfigLayout();
		}
	});

	$(document).mousedown(function(e) {
		const $trg = $(e.target);
		if ($trg.hasClass('layoutDrag')) {
			e.preventDefault;
			const $cont = $('#layoutGridCont');
			const $pip = $trg.parent();
			$cont.addClass('resizeShadow');
			$cont.mousemove(function(e) {
				doResizeShadow(e)
			});
			$cont.attr('data-col-end', $pip.attr('data-col-end'));
			$cont.attr('data-col-start', $pip.attr('data-col-start'));
			$cont.attr('data-row-end', $pip.attr('data-row-end'));
			$cont.attr('data-row-start', $pip.attr('data-row-start'));
			$pip.addClass('resizing');
			$trg.addClass('resizingDir');
		}
	});

	$(document).mouseup(function(e) {
		doResize(e);
		const $cont = $('#layoutGridCont');
		$cont.off('mousemove');
		$cont.removeClass('resizeShadow');
	});

	$(document).on('submit', function(e) {
		const $trg = $(e.target);
		if ($trg.hasClass('renameForm')) {
			e.preventDefault();
			const text = $trg.find('.renameLayoutInput').val();
			getActiveLayout().Name = text;
			drawAdvancedLayoutSelect();
		}
	});

	$(document).keyup(function(e) {
		const $trg = $(e.target);
		if (e.key === "Escape") {
			$('body').removeClass('fullscreen');
			document.exitFullscreen();
	   } else if ($trg.is('#thumbinput')) {
			const $sources = $('#thumbCont').children();
			const search = $trg.val().toLowerCase();
			$sources.each(function(i, source) {
				const $source = $(source);
				const name = $source.attr('data-name').toLowerCase();
				if (name.includes(search) || search.includes(name)) {
					$source.removeClass('d-none');
				} else {
					$source.addClass('d-none');
				}
			});
			console.log($trg.val());
		}
   	});

	setInterval(() => {
		for (thumb of document.getElementsByClassName('thumbnail')) {
			if (prod) thumb.src = thumb.dataset.src + "?" + new Date().getTime();
		}
	}, 1000)
});

{ // Config
	function configRowDone($trg) {
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
	}
	
	function configRowAdd() {
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
	}
	
	function configSave() {
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
	}
	
	function configRowDelete($trg) {
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
	}
	
	function configRowEdit($trg) {
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
				let txt = `<select class="form-control form-select" name="${$td.data('key')}">`;
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
	}
}


function layoutSave() {
	const thisLayout = getActiveLayout();
	$cont = $('#layoutGridCont');
	thisLayout.Columns = Number($cont.attr('data-cols'));
	thisLayout.Rows = Number($cont.attr('data-rows'));
	thisLayout.Pips = {};
	$cont.children().each(function(i, pip) {
		$pip = $(pip);
		const id = Number($pip.attr('data-pip'));
		const rowStart = Number($pip.attr('data-row-start'));
		const rowEnd = Number($pip.attr('data-row-end'));
		const colStart = Number($pip.attr('data-col-start'));
		const colEnd = Number($pip.attr('data-col-end'));
		thisLayout.Pips[id] = {
			'rowStart':rowStart,
			'rowEnd':rowEnd,
			'colStart':colStart,
			'colEnd':colEnd
		}
	});
	$.ajax(`${server}setlayouts`, {
		data : JSON.stringify(layouts),
		contentType : 'application/json',
		type : 'POST'}
	)
}

function doResize(e) {
	const $resizing = $('.resizing');
	const $resizingDir = $('.resizingDir');
	if ($resizing.length < 1) return;
	$resizing.removeClass('resizing');
	$resizingDir.removeClass('resizingDir');

	const $cont = $('#layoutGridCont');
	const left = $cont.offset().left;
	const width = $cont.width();
	const cols = Number($cont.attr('data-cols'));
	const newColPos = Math.ceil((cols * (e.pageX - left))/width);

	const top = $cont.offset().top;
	const height = $cont.height();
	const rows = Number($cont.attr('data-rows'));
	const newRowPos = Math.ceil((rows * (e.pageY - top))/height);
	
	if (newColPos > cols || newRowPos > rows || newColPos < 1 || newRowPos < 1) return;

	const oldDims = {
		'col':{
			'start':Number($resizing.attr('data-col-start')),
			'end':Number($resizing.attr('data-col-end'))
		},
		'row': {
			'start':Number($resizing.attr('data-row-start')),
			'end':Number($resizing.attr('data-row-end'))
		}
	}
	const newDims = {
		'col':{
			'start':Number($resizing.attr('data-col-start')),
			'end':Number($resizing.attr('data-col-end'))
		},
		'row': {
			'start':Number($resizing.attr('data-row-start')),
			'end':Number($resizing.attr('data-row-end'))
		}
	}

	if (newColPos > oldDims.col.end) {
		newDims.col.start = oldDims.col.start;
		newDims.col.end = newColPos;
	} else if (newColPos < oldDims.col.start) {
		newDims.col.start = newColPos;
		newDims.col.end = oldDims.col.end;
	} else if ($resizingDir.hasClass('layoutDragR') || $resizingDir.hasClass('layoutDragTR') || $resizingDir.hasClass('layoutDragBR')) {
		newDims.col.start = oldDims.col.start;
		newDims.col.end = newColPos;
	} else if ($resizingDir.hasClass('layoutDragL') || $resizingDir.hasClass('layoutDragTL') || $resizingDir.hasClass('layoutDragBL')) {
		newDims.col.start = newColPos;
		newDims.col.end = oldDims.col.end;
	}
	
	if (newRowPos > oldDims.row.end) {
		newDims.row.start = oldDims.row.start;
		newDims.row.end = newRowPos;
	} else if (newRowPos < oldDims.row.start) {
		newDims.row.start = newRowPos;
		newDims.row.end = oldDims.row.end;
	} else if ($resizingDir.hasClass('layoutDragB') || $resizingDir.hasClass('layoutDragBR') || $resizingDir.hasClass('layoutDragBL')) {
		newDims.row.start = oldDims.row.start;
		newDims.row.end = newRowPos;
	} else if ($resizingDir.hasClass('layoutDragT') || $resizingDir.hasClass('layoutDragTL') || $resizingDir.hasClass('layoutDragTR')) {
		newDims.row.start = newRowPos;
		newDims.row.end = oldDims.row.end;
	}
	
	$resizing.attr('data-col-end', newDims.col.end);
	$resizing.attr('data-col-start', newDims.col.start);
	$resizing.attr('data-row-end', newDims.row.end);
	$resizing.attr('data-row-start', newDims.row.start);


	for (let c = oldDims.col.start; c < oldDims.col.end+1; c++) {
		for (let r = oldDims.row.start; r < oldDims.row.end+1; r++) {
			$cont.append(
				ejs.render(layoutDragTemplate, {
					pip: {
						'id': 100,
						'colStart': c,
						'colEnd': c,
						'rowStart': r,
						'rowEnd': r
					}
				})
			);
		}
	}


	$cont.children().each(function(i, pip) {
		const $pip = $(pip);
		if ($pip.is($resizing)) return;
		const pipRowStart = Number($pip.attr('data-row-start'));
		const pipRowEnd = Number($pip.attr('data-row-end'));
		const pipColStart = Number($pip.attr('data-col-start'));
		const pipColEnd = Number($pip.attr('data-col-end'));

		const rowStartBetween = (newDims.row.start <= pipRowStart && pipRowStart <= newDims.row.end);
		const rowEndBetween = (newDims.row.start <= pipRowEnd && pipRowEnd <= newDims.row.end);
		const colStartBetween = (newDims.col.start <= pipColStart && pipColStart <= newDims.col.end);
		const colEndBetween = (newDims.col.start <= pipColEnd && pipColEnd <= newDims.col.end);
		const rowOutside = (pipRowStart <= newDims.row.start && newDims.row.end <= pipRowEnd);
		const colOutside = (pipColStart <= newDims.col.start && newDims.col.end <= pipColEnd);

		let split = false;
		if ((rowStartBetween || rowEndBetween) && (colStartBetween || colEndBetween)) split = true;
		if (colOutside && (rowStartBetween || rowEndBetween)) split = true;
		if (rowOutside && (colStartBetween || colEndBetween)) split = true;

		if (split) console.log('Split');
		if (split) pipSplit(pip);
	});

	$cont.children().each(function(i, pip) {
		const $pip = $(pip);
		if ($pip.is($resizing)) return;
		const pipRowStart = Number($pip.attr('data-row-start'));
		const pipRowEnd = Number($pip.attr('data-row-end'));
		const pipColStart = Number($pip.attr('data-col-start'));
		const pipColEnd = Number($pip.attr('data-col-end'));

		const rowStartBetween = (newDims.row.start <= pipRowStart && pipRowStart <= newDims.row.end);
		const rowEndBetween = (newDims.row.start <= pipRowEnd && pipRowEnd <= newDims.row.end);
		const colStartBetween = (newDims.col.start <= pipColStart && pipColStart <= newDims.col.end);
		const colEndBetween = (newDims.col.start <= pipColEnd && pipColEnd <= newDims.col.end);

		if ((rowStartBetween || rowEndBetween) && (colStartBetween || colEndBetween)) {
			$pip.remove();
		}
	});

	renumberPips();
}

function doResizeShadow(e) {
	const $resizing = $('.resizing');
	const $resizingDir = $('.resizingDir');
	if ($resizing.length < 1) return;
	const $cont = $('#layoutGridCont');
	const left = $cont.offset().left;
	const width = $cont.width();
	const cols = Number($cont.attr('data-cols'));
	const newColPos = Math.ceil((cols * (e.pageX - left))/width);

	const top = $cont.offset().top;
	const height = $cont.height();
	const rows = Number($cont.attr('data-rows'));
	const newRowPos = Math.ceil((rows * (e.pageY - top))/height);
	
	if (newColPos > cols || newRowPos > rows || newColPos < 1 || newRowPos < 1) return;

	const oldDims = {
		'col':{
			'start':Number($resizing.attr('data-col-start')),
			'end':Number($resizing.attr('data-col-end'))
		},
		'row': {
			'start':Number($resizing.attr('data-row-start')),
			'end':Number($resizing.attr('data-row-end'))
		}
	}
	const newDims = {
		'col':{
			'start':Number($resizing.attr('data-col-start')),
			'end':Number($resizing.attr('data-col-end'))
		},
		'row': {
			'start':Number($resizing.attr('data-row-start')),
			'end':Number($resizing.attr('data-row-end'))
		}
	}

	if (newColPos > oldDims.col.end) {
		newDims.col.start = oldDims.col.start;
		newDims.col.end = newColPos;
	} else if (newColPos < oldDims.col.start) {
		newDims.col.start = newColPos;
		newDims.col.end = oldDims.col.end;
	} else if ($resizingDir.hasClass('layoutDragR') || $resizingDir.hasClass('layoutDragTR') || $resizingDir.hasClass('layoutDragBR')) {
		newDims.col.start = oldDims.col.start;
		newDims.col.end = newColPos;
	} else if ($resizingDir.hasClass('layoutDragL') || $resizingDir.hasClass('layoutDragTL') || $resizingDir.hasClass('layoutDragBL')) {
		newDims.col.start = newColPos;
		newDims.col.end = oldDims.col.end;
	}
	
	if (newRowPos > oldDims.row.end) {
		newDims.row.start = oldDims.row.start;
		newDims.row.end = newRowPos;
	} else if (newRowPos < oldDims.row.start) {
		newDims.row.start = newRowPos;
		newDims.row.end = oldDims.row.end;
	} else if ($resizingDir.hasClass('layoutDragB') || $resizingDir.hasClass('layoutDragBR') || $resizingDir.hasClass('layoutDragBL')) {
		newDims.row.start = oldDims.row.start;
		newDims.row.end = newRowPos;
	} else if ($resizingDir.hasClass('layoutDragT') || $resizingDir.hasClass('layoutDragTL') || $resizingDir.hasClass('layoutDragTR')) {
		newDims.row.start = newRowPos;
		newDims.row.end = oldDims.row.end;
		newRow = true;
	}
	
	$cont.attr('data-col-end', newDims.col.end);
	$cont.attr('data-col-start', newDims.col.start);
	$cont.attr('data-row-end', newDims.row.end);
	$cont.attr('data-row-start', newDims.row.start);
}


function pipSplit(pip) {
	const $pip = $(pip);
	const colEnd = Number($pip.attr('data-col-end'));
	const colStart = Number($pip.attr('data-col-start'));
	const rowEnd = Number($pip.attr('data-row-end'));
	const rowStart = Number($pip.attr('data-row-start'));
	if (colEnd == colStart && rowEnd == rowStart) return;
	console.log('Splitting:', pip);
	for (let r = rowStart; r < rowEnd+1; r++) {
		for (let c = colStart; c < colEnd+1; c++) {
			$('#layoutGridCont').append(
				ejs.render(layoutDragTemplate, {
					pip: {
						'id': 100,
						'colStart': c,
						'colEnd': c,
						'rowStart': r,
						'rowEnd': r
					}
				})
			);
		}
	}
	$pip.remove();
}

function renumberPips() {
	$('#layoutGridCont').children().each(function(i, pip) {
		$(pip).attr('data-pip', i+1);
	})
}

function getActiveLayout() {
	return layouts.filter(layout => layout.ID == activeLayout)[0];
}

function setActiveLayout(number) {
	activeLayout = Number(number);
	Cookies.set('activeLayout', JSON.stringify(activeLayout), {
		SameSite: 'Lax'
	});
}

function drawAdvancedLayoutSelect() {
	$tabCont = $('#nav-tab');
	$tabCont.html('');
	$tabViewCont = $('#layoutTabs');
	$tabViewCont.html('');

	layouts.forEach(layout => {
		const id = layout.ID;
		$button = `<button class="nav-link layoutConfigSelect" id="layout${id}-tab" data-id="${id}" data-bs-toggle="tab" data-bs-target="#layout${id}" type="button" role="tab" aria-controls="layout${id}" aria-selected="false" tabindex="-1">${layout.Name}</button>`;
		$tabCont.append($button);
		$viewButton = `<button class="btn btn-secondary layout-btn me-1" id="nav-layout-${id}-tab" data-id="${id}" data-bs-toggle="tab" data-bs-target="#layout${id}" type="button" aria-selected="false" role="tab" tabindex="-1">${layout.Name}</button>`
		$tabViewCont.append($viewButton);
	});
	$tabCont.children(`[data-id="${activeLayout}"]`).click();
	$tabViewCont.children(`[data-id="${activeLayout}"]`).click();
}

function drawConfigLayout() {
	const thisLayout = getActiveLayout();
	const $cont = $("#layoutGridCont");
	$cont.attr("data-cols", thisLayout.Columns);
	$cont.attr("data-rows", thisLayout.Rows);
	$('#layoutCols').val(thisLayout.Columns);
	$('#layoutRows').val(thisLayout.Rows);

	$cont.html('');

	const pips = thisLayout.Pips;
	for (const pip in pips) {
		if (pips.hasOwnProperty.call(pips, pip)) {
			const pipProps = pips[pip];
			$cont.append(
				ejs.render(layoutDragTemplate, {
					pip: {
						'id': pip,
						'colStart': pipProps.colStart,
						'colEnd': pipProps.colEnd,
						'rowStart': pipProps.rowStart,
						'rowEnd': pipProps.rowEnd
					}
				})
			);
		}
	}
};

function updateConfigLayout() {
	const thisLayout = getActiveLayout();
	const $cont = $("#layoutGridCont");
	const oldCols = Number($cont.attr("data-cols"));
	const oldRows = Number($cont.attr("data-rows"));
	$cont.attr("data-cols", thisLayout.Columns);
	$cont.attr("data-rows", thisLayout.Rows);
	$('#layoutCols').val(thisLayout.Columns);
	$('#layoutRows').val(thisLayout.Rows);

	let pip = $cont.children().length + 1;

	if (oldRows < thisLayout.Rows) {
		for (let r = oldRows; r < thisLayout.Rows; r++) {
			for (let c = 1; c < (thisLayout.Columns)+1; c++) {
				$cont.append(
					ejs.render(layoutDragTemplate, {
						pip: {
							'id': pip,
							'colStart': c,
							'colEnd': c,
							'rowStart': r+1,
							'rowEnd': r+1
						}
					})
				);
				pip++;
			}
		}
	} else if (oldRows > thisLayout.Rows) {
		for (let index = thisLayout.Rows+1; index < oldRows+1; index++) {
			const $pips = $(`[data-row-end="${index}"]`);
			$pips.each(function(i, pip) {
				$pip = $(pip);
				if (Number($pip.attr('data-row-start')) >= thisLayout.Rows) {
					$pip.remove();
				} else {
					$pip.attr('data-row-start', thisLayout.Rows);
				}
			});
		}
	}

	if (oldCols < thisLayout.Columns) {
		for (let r = 1; r < (thisLayout.Rows)+1; r++) {
			for (let c = oldCols; c < thisLayout.Columns; c++) {
				$cont.append(
					ejs.render(layoutDragTemplate, {
						pip: {
							'id': pip,
							'colStart': c+1,
							'colEnd': c+1,
							'rowStart': r,
							'rowEnd': r
						}
					})
				);
				pip++;
			}
		}
	} else if (oldCols > thisLayout.Columns) {
		for (let index = thisLayout.Columns+1; index < oldCols+1; index++) {
			const $pips = $(`[data-col-end="${index}"]`);
			$pips.each(function(i, pip) {
				$pip = $(pip);
				if (Number($pip.attr('data-col-start')) >= thisLayout.Columns) {
					$pip.remove();
				} else {
					$pip.attr('data-col-start', thisLayout.Columns);
				}
			});
		}
	}

	renumberPips();
};

function choseWindows(number) {
	setActiveLayout(number);
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
	Cookies.set('activeLayout', JSON.stringify(activeLayout), {
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
	const pip = Number($selectedCont.closest('.player-quad').attr('data-pip'));
	mapping[pip] = streamID;
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
		if ($element.hasClass('ovenplayer')) {
			OvenPlayer.getPlayerByContainerId($element.attr('id')).remove();
		} else {
			
		}
		$element.remove();
		const pip = Number($cont.attr('data-pip'));
		mapping[pip] = 0;
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
			getConfig('layouts').then(values => {
				layouts = values;
				loading(false);
				buildLayoutAdvanced();
				drawAdvancedLayoutSelect();
			}).catch(error => {
				console.error(error);
			});
			break;
		default:
			break;
	}
}

function buildThumbnails() {
	const $aside = $('#thumbList');
	const $thumbCont = $('#thumbCont');
	$thumbCont.html('');
	encoders.forEach(encoder => {
		$thumbCont.append(`<div class="card text-white mb-1 sourceSelect"
		id="player-${encoder.Name.replace(/ /g,'-')}-cont"
		data-id="${encoder.ID}"
		data-url="${encoder.URL}"
		data-name="${encoder.Name}"
		data-type="${encoder.Type}">
			<section class="playerTitle">
				<h5 class="card-title feed-title" data-id="${encoder.ID}">${encoder.Name}</h5>
			</section>
			<img class="thumbnail card-img-top"
				src="${encoder.URL.replace('ws://', 'http://').replace('3333', '9998')}/thumb.jpg"
				data-src="${encoder.URL.replace('ws://', 'http://').replace('3333', '9998')}/thumb.jpg"
				onerror="if (this.src != 'img/holding.png') this.src = 'img/holding.png';">
		</div>`);
	});
	$("#thumbSearch").remove();
	if (allowSearch && encoders.length > 4 && layout != 'thumbnail') {
		$aside.prepend(`<div id="thumbsearch" class="text-white mb-1 input-group position-sticky top-0 z-1" data-bs-theme="dark" style="">
			<input id="thumbinput" class="form-control form-control-sm" type="text" placeholder="Search">
			<button id="thumbclear" class="btn btn-secondary btn-sm">⌫</button>
		</div>`);
		$('.sourceSelect').removeClass('d-none');
	}
}

function loadPips() {
	const mappingUnparsed = Cookies.get('mapping');	
	if (mappingUnparsed === undefined) return;
	mapping = JSON.parse(mappingUnparsed);
	$('.selectedPlayer').removeClass('selectedPlayer');
	$('#views').children().each(function(i, window) {
		const $window = $(window);
		const pip = Number($window.attr('data-pip'));
		const streamID = mapping[pip]
		if (!streamID) return;
		$window.addClass('selectedPlayer');
		openPlayer($(`.sourceSelect[data-id="${streamID}"]`));
		$window.removeClass('selectedPlayer');
	});
}

function buildLayoutBasic() {
	const layoutUnparsed = Cookies.get('activeLayout');
	if (layoutUnparsed === undefined) return;
	setActiveLayout(JSON.parse(layoutUnparsed));
	choseWindows(activeLayout);
	loadPips();
}

function buildLayoutAdvanced() {
	const thisLayout = getActiveLayout();
	const pips = thisLayout.Pips;
	const $cont = $('#views');
	$cont.attr('data-cols', thisLayout.Columns);
	$cont.attr('data-rows', thisLayout.Rows);
	$cont.html('');
	for (const pip in pips) {
		if (pips.hasOwnProperty.call(pips, pip)) {
			const pipProps = pips[pip];
			$cont.append(`<div class="text-light player-quad layoutPip"
				data-pip="${pip}"
				data-row-start="${pipProps.rowStart}"
				data-row-end="${pipProps.rowEnd}"
				data-col-start="${pipProps.colStart}"
				data-col-end="${pipProps.colEnd}">
				<div class="d-flex justify-content-between">
					<h4 class="player-title feed-title" data-title="Choose Camera">Choose Camera</h4>
					<div class="d-flex my-auto mx-1">
						<button class="btn mutePlayer muted btn-close btn-close-white" type="button"></button>
						<button class="btn fullPlayer btn-close btn-close-white mx-2" type="button"></button>
						<button class="btn closePlayer btn-close btn-close-white" type="button"></button>
					</div>
				</div>
				<div class="player-container"></div>
			</div>`);
		}
	}
	loadPips();
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