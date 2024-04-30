import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { html } from 'htm/react';
import { SVResizeObserver } from 'scrollview-resize';
import infermaticLogo from '../../img/infermatic_logo.png';

// Polyfill for piece of shit Chromium
if (!(Symbol.asyncIterator in ReadableStream.prototype)) {
	ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
		const reader = this.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done)
					return;
				yield value;
			}
		} finally {
			reader.releaseLock();
		}
	};
}

export async function getTokenCount({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	switch (endpointAPI) {
		case 0: // llama.cpp
			return await llamaCppTokenCount({ endpoint, endpointAPIKey, signal, ...options });
		case 2: // koboldcpp
			return await koboldCppTokenCount({ endpoint, signal, ...options });
		case 3: // openai // TODO: Fix this for official OpenAI?
			let tokenCount = 0;
			// tokenCount = await openaiOobaTokenCount({ endpoint, signal, ...options });
			// if (tokenCount != -1)
			// 	return tokenCount;
			// tokenCount = await openaiTabbyTokenCount({ endpoint, endpointAPIKey, signal, ...options });
			// if (tokenCount != -1)
			// 	return tokenCount;
			// return 0;
			return 0;
	}
}

export async function getModels({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	switch (endpointAPI) {
		case 3: // openai
			return await openaiModels({ endpoint, endpointAPIKey, signal, ...options });
		case 3: // infermatic
			return await infermaticModels({ endpointAPIKey, signal, ...options });
		default:
			return [];
	}
}

export async function* completion({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	switch (endpointAPI) {
		case 0: // llama.cpp
			return yield* await llamaCppCompletion({ endpoint, endpointAPIKey, signal, ...options });
		case 2: // koboldcpp
			return yield* await koboldCppCompletion({ endpoint, signal, ...options });
		case 3: // openai
			return yield* await openaiCompletion({ endpoint, endpointAPIKey, signal, ...options });
			case 4: // infermatic
			return yield* await infermaticCompletion({ endpointAPIKey, signal, ...options });
	}
}

export async function abortCompletion({ endpoint, endpointAPI }) {
	switch (endpointAPI) {
		case 2: // koboldcpp
			return await koboldCppAbortCompletion({ endpoint });
		case 3: // openai (ooba)
			return await openaiOobaAbortCompletion({ endpoint });
		case 4: // infermatic (ooba)
			endpoint='https://api.totalgpt.ai';
			return await openaiOobaAbortCompletion({ endpoint });
	}
}

// Function to parse text/event-stream data and yield JSON objects
// Function to parse text/event-stream data and yield JSON objects
async function* parseEventStream(eventStream) {
	try {
		let buf = '';
		let ignoreNextLf = false;

		for await (let chunk of eventStream.pipeThrough(new TextDecoderStream())) {
			// A CRLF could be split between chunks, so if the last chunk ended in
			// CR and this chunk started with LF, trim the LF
			if (ignoreNextLf && /^\n/.test(chunk)) {
				chunk = chunk.slice(1);
			}
			ignoreNextLf = /\r$/.test(chunk);

			// Event streams must be parsed line-by-line (ending in CR, LF, or CRLF)
			const lines = (buf + chunk).split(/\n|\r\n?/);
			buf = lines.pop();
			let type, data;

			for (const line of lines) {
				if (!line || line === 'data: All connection attempts failed') {
					type = undefined;
					data = undefined;
					continue;
				}
				const { name, value } = /^(?<name>.*?)(?:: ?(?<value>.*))?$/s.exec(line).groups;
				switch (name) {
					case 'event':
						type = (value ?? '');
						break;
					case 'data':
						data = data === undefined ? (value ?? '') : `${data}\n${value}`;
						break;
				}
				// We only emit message-type events for now (and assume JSON)
				if (data && (type || 'message') === 'message') {
					if (data === '[DONE]' || data === '[ERROR]') {
						return;
					}
					const json = JSON.parse(data);
					// Both Chrome and Firefox suck at debugging
					// text/event-stream, so make it easier by logging events
					console.log('event', json);
					yield json;
					type = undefined;
					data = undefined;
				}
			}
		}
	} finally {
		if (eventStream.locked) {
			console.log('Stream bloqued cannot cancel');
		
		} else {
			console.log('Stream paused');
			eventStream.cancel();
			
		}
	}
}

async function llamaCppTokenCount({ endpoint, endpointAPIKey, signal, ...options }) {
	try{
		if(!endpoint){
			console.error('Endpoint is empty. No request will be made.');
			return;
		}else{
			if (!endpoint || !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
				console.error(' URL invalid:', endpoint);
				return;
			  }
			const res = await fetch(new URL('/tokenize', endpoint), {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(endpointAPIKey ? { 'Authorization': `Bearer ${endpointAPIKey}` } : {}),
				},
				body: JSON.stringify(options),
				signal,
			});
			if (!res.ok)
				throw new Error(`HTTP ${res.status}`);
			const { tokens } = await res.json();
			return tokens.length + 1; // + 1 for BOS, I guess.
		}
	}catch(error){
		console.log(error);
	}
	
}

async function* llamaCppCompletion({ endpoint, endpointAPIKey, signal, ...options }) {
	try{
		const res = await fetch(new URL('/completion', endpoint), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(endpointAPIKey ? { 'Authorization': `Bearer ${endpointAPIKey}` } : {}),
			},
			body: JSON.stringify({
				...options,
				stream: true,
				cache_prompt: true,
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		return yield* await parseEventStream(res.body);
	}catch(error){
	console.log(error);
}
}

async function koboldCppTokenCount({ endpoint, signal, ...options }) {
	try{
		if(!endpoint){
			console.error('Endpoint is empty. No request will be made.');
			return;
		}else{
			try {
				const res = await fetch(new URL('/api/extra/tokencount', endpoint), {
				  method: 'POST',
				  headers: {
					'Content-Type': 'application/json',
				  },
				  body: JSON.stringify({
					prompt: options.content
				  }),
				  signal,
				});
				if (!res.ok)
				  throw new Error(`HTTP ${res.status}`);
			
				const { value } = await res.json();
				return value;
			  } catch (error) {
				// Handle or log the error as needed
				console.error('An error occurred:', error);
				// Depending on your use case, you might want to rethrow the error, return a default value, etc.
				throw error; // or return some default value
			  }
		}
	}catch(error){
		console.log(error);
	}
	
	
  }
  

function koboldCppConvertOptions(options) {
	const swapOption = (lhs, rhs) => {
		if (lhs in options) {
			options[rhs] = options[lhs];
			delete options[lhs];
		}
	};
	if (options.n_predict === -1) {
		options.n_predict = 1024;
	}
	swapOption("n_ctx", "max_context_length");
	swapOption("n_predict", "max_length");
	swapOption("repeat_penalty", "rep_pen");
	swapOption("repeat_last_n", "rep_pen_range");
	swapOption("tfs_z", "tfs");
	swapOption("typical_p", "typical");
	swapOption("seed", "sampler_seed");
	swapOption("stop", "stop_sequence");
	swapOption("ignore_eos", "use_default_badwordsids");
	return options;
}

async function* koboldCppCompletion({ endpoint, signal, ...options }) {
	try{
		const res = await fetch(new URL('/api/extra/generate/stream', endpoint), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				...koboldCppConvertOptions(options),
				stream: true,
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		for await (const chunk of parseEventStream(res.body)) {
			yield { content: chunk.token };
		}
	}catch(error){
		console.log(error);
	}
	
}

async function koboldCppAbortCompletion({ endpoint }) {
	await fetch(new URL('/api/extra/abort', endpoint), {
		method: 'POST',
	});
}

async function openaiOobaTokenCount({ endpoint, signal, ...options }) {
	try{
		if(!endpoint)
		{
			console.error('Endpoint is empty. No request will be made.');
			return;
		}else{
			try {
				const res = await fetch(new URL('/v1/internal/token-count', endpoint), {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						text: options.content
					}),
					signal,
				});
				if (!res.ok)
					throw new Error(`HTTP ${res.status}`);
				const { length } = await res.json();
				return length;
			} catch (e) {
				reportError(e);
				return -1;
			}
		}
	}catch(error){
		console.log(error);
	}
	
	
}

async function openaiTabbyTokenCount({ endpoint, endpointAPIKey, signal, ...options }) {
	try {
		const res = await fetch(new URL('/v1/token/encode', endpoint), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${endpointAPIKey}`,
			},
			body: JSON.stringify({
				text: options.content
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const tokens = await res.json();
		return tokens.length;
	} catch (e) {
		reportError(e);
		return -1;
	}
}

async function openaiModels({ endpoint, endpointAPIKey, signal, ...options }) {
	try{
		const res = await fetch(new URL('/v1/models', endpoint), {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${endpointAPIKey}`,
			},
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const { data } = await res.json();
		return data.map(item => item.id);
	}catch(error){
		console.log(error);
	}
	
}

function openaiConvertOptions(options, isOpenAI) {
	const swapOption = (lhs, rhs) => {
		if (lhs in options) {
			options[rhs] = options[lhs];
			delete options[lhs];
		}
	};
	if (options.n_predict === -1) {
		options.n_predict = 1024;
	}
	if (isOpenAI && options.n_probs > 5) {
		options.n_probs = 5;
	}
	if ("dynatemp_range" in options && options.dynatemp_range !== 0) {
		// oobabooga specific.
		options.dynamic_temperature = true;
		options.dynatemp_low = Math.max(0, options.temperature - options.dynatemp_range);
		options.dynatemp_high = Math.max(0, options.temperature + options.dynatemp_range);
	}
	if (!isOpenAI && options.temperature === 0) {
		// oobabooga specific.
		options.do_sample = false;
	}
	swapOption("n_ctx", "max_context_length");
	swapOption("n_predict", "max_tokens");
	swapOption("n_probs", "logprobs");
	swapOption("repeat_penalty", "repetition_penalty");
	swapOption("repeat_last_n", "repetition_penalty_range");
	swapOption("tfs_z", "tfs");
	swapOption("mirostat", "mirostat_mode");
	swapOption("ignore_eos", "ban_eos_token")
	return options;
}

async function* openaiCompletion({ endpoint, endpointAPIKey, signal, ...options }) {
	const res = await fetch(new URL('/v1/completions', endpoint), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${endpointAPIKey}`,
		},
		body: JSON.stringify({
		// 	...openaiConvertOptions(options, endpoint.toLowerCase().includes("openai.com")),
			"model": options.model,
			"prompt": options.prompt,
			"max_new_tokens": options.n_predict,
		 	stream: true,
		}),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	for await (const chunk of parseEventStream(res.body)) {
		const logprobs = Object.entries(chunk.choices[0].logprobs?.top_logprobs?.[0] ?? {});
		const probs = logprobs.map(([tok, logprob]) => ({ tok_str: tok, prob: Math.exp(logprob) }));
		yield {
			content: chunk.choices[0].text,
			completion_probabilities: [{
				content: chunk.choices[0].text,
				probs
			}]
		};
	}
}

async function infermaticOobaTokenCount({  signal, ...options }) {
	let endpoint = new URL('https://api.totalgpt.ai/');
	try {
		const res = await fetch(new URL('/v1/internal/token-count', endpoint), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				text: options.content
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const { length } = await res.json();
		return length;
	} catch (e) {
		reportError(e);
		return -1;
	}
}
async function infermaticTabbyTokenCount({endpointAPIKey, signal, ...options }) {
	let endpoint = new URL('https://api.totalgpt.ai/');
	try {
		const res = await fetch(new URL('/v1/token/encode', endpoint), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${endpointAPIKey}`,
			},
			body: JSON.stringify({
				text: options.content
			}),
			signal,
		});
		if (!res.ok)
			throw new Error(`HTTP ${res.status}`);
		const tokens = await res.json();
		return tokens.length;
	} catch (e) {
		reportError(e);
		return -1;
	}
}

async function infermaticModels({ endpointAPIKey, signal, ...options }) {
	let endpoint = new URL('https://api.totalgpt.ai/');
	const res = await fetch(new URL('/v1/models', endpoint), {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${endpointAPIKey}`,
		},
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	const { data } = await res.json();
	return data.map(item => item.id);
}

function infermaticConvertOptions(options, isOpenAI) {
	const swapOption = (lhs, rhs) => {
		if (lhs in options) {
			options[rhs] = options[lhs];
			delete options[lhs];
		}
	};
	if (options.n_predict === -1) {
		options.n_predict = 1024;
	}
	if (isOpenAI && options.n_probs > 5) {
		options.n_probs = 5;
	}
	if ("dynatemp_range" in options && options.dynatemp_range !== 0) {
		// oobabooga specific.
		options.dynamic_temperature = true;
		options.dynatemp_low = Math.max(0, options.temperature - options.dynatemp_range);
		options.dynatemp_high = Math.max(0, options.temperature + options.dynatemp_range);
	}
	if (!isOpenAI && options.temperature === 0) {
		// oobabooga specific.
		options.do_sample = false;
	}
	swapOption("n_ctx", "max_context_length");
	swapOption("n_predict", "max_tokens");
	swapOption("n_probs", "logprobs");
	swapOption("repeat_penalty", "repetition_penalty");
	swapOption("repeat_last_n", "repetition_penalty_range");
	swapOption("tfs_z", "tfs");
	swapOption("mirostat", "mirostat_mode");
	swapOption("ignore_eos", "ban_eos_token")
	return options;
}

async function* infermaticCompletion({ endpointAPIKey, signal, ...options }) {
	let endpoint = new URL('https://api.totalgpt.ai/');
	const res = await fetch(new URL('/v1/completions', endpoint), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${endpointAPIKey}`,
		},
		body: JSON.stringify({
		// 	...openaiConvertOptions(options, endpoint.toLowerCase().includes("openai.com")),
			"model": options.model,
			"prompt": options.prompt,
			"max_new_tokens": options.n_predict,
		 	stream: true,
		}),
		signal,
	});
	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);
	for await (const chunk of parseEventStream(res.body)) {
		const logprobs = Object.entries(chunk.choices[0].logprobs?.top_logprobs?.[0] ?? {});
		const probs = logprobs.map(([tok, logprob]) => ({ tok_str: tok, prob: Math.exp(logprob) }));
		yield {
			content: chunk.choices[0].text,
			completion_probabilities: [{
				content: chunk.choices[0].text,
				probs
			}]
		};
	}
}

async function openaiOobaAbortCompletion({ endpoint }) {
	try {
		await fetch(new URL('/v1/internal/stop-generation', endpoint), {
			method: 'POST',
		});
	} catch (e) {
		reportError(e);
	}
}

function InputBox({ label, tooltip, tooltipSize, value, type, datalist, onValueChange, ...props }) {
	return html`
		<label className="InputBox ${tooltip ? 'tooltip' : ''}">
			${label}
			<input
				type=${type || 'text'}
				list="${datalist ? label : ''}"
				value=${value}
				size="1"
				onChange=${({ target }) => {
					let value = type === 'number' ? target.valueAsNumber : target.value;
					if (props.inputmode === 'numeric') {
						props.pattern = '^-?[0-9]*$';
						if (value && !isNaN(+value))
							value = +target.value;
					}
					if (props.pattern && !new RegExp(props.pattern).test(value))
						return;
					onValueChange(value);
				}}
				...${props}/>
			${datalist && html`
				<datalist id="${label}">
					${datalist.map(opt => html`
						<option key="${opt}">
							${opt}
						</option>`)}
				</datalist>`}
			${tooltip && html`
				<span class="tooltiptext ${tooltipSize || ''}">
					${tooltip}
				</span>`}
		</label>`;
}

function SelectBox({ label, value, onValueChange, options, ...props }) {
	return html`
		<label className="SelectBox">
			${label}
			<select
				value=${value}
				onChange=${({ target }) => onValueChange(JSON.parse(target.value))}
				...${props}>
				${options.map(o => html`<option
					key=${JSON.stringify(o.value)}
					value=${JSON.stringify(o.value)}>${o.name}</option>`)}
			</select>
		</label>`;
}

function Checkbox({ label, value, onValueChange, ...props }) {
	return html`
		<label className="Checkbox">
			<input
				type="checkbox"
				checked=${value}
				onChange=${({ target }) => onValueChange(target.checked)}
				...${props}/>
			${label}
		</label>`;
}

function CollapsibleGroup({ label, expanded, children }) {
	const contentArea = useRef(null);
	const [contentHeight, setContentHeight] = useState(!expanded ? 0 : '');
	const [isCollapsed, setIsCollapsed] = useState(!expanded);

	useEffect(() => {
		setContentHeight(contentArea.current.scrollHeight);
		const observer = new SVResizeObserver(() => {
			setContentHeight(contentArea.current.scrollHeight);
		});
		observer.observe(contentArea.current);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		setContentHeight(contentArea.current.scrollHeight);
	}, [isCollapsed]);


	const expandSvg = html`<svg fill="var(--color-light)" height="12" width="12" viewBox="0 0 330 330"><path d="M325.607,79.393c-5.857-5.857-15.355-5.858-21.213,0.001l-139.39,139.393L25.607,79.393 c-5.857-5.857-15.355-5.858-21.213,0.001c-5.858,5.858-5.858,15.355,0,21.213l150.004,150c2.813,2.813,6.628,4.393,10.606,4.393 s7.794-1.581,10.606-4.394l149.996-150C331.465,94.749,331.465,85.251,325.607,79.393z"/></svg>`;
	const collapseSvg = html`<svg fill="var(--color-light)" height="12" width="12" viewBox="0 0 330 330"><path d="M325.606,229.393l-150.004-150C172.79,76.58,168.974,75,164.996,75c-3.979,0-7.794,1.581-10.607,4.394 l-149.996,150c-5.858,5.858-5.858,15.355,0,21.213c5.857,5.857,15.355,5.858,21.213,0l139.39-139.393l139.397,139.393 C307.322,253.536,311.161,255,315,255c3.839,0,7.678-1.464,10.607-4.394C331.464,244.748,331.464,235.251,325.606,229.393z"/></svg>`;

	return html`
		<div className="collapsible-group">
			<div className="collapsible-header" onClick=${() => setIsCollapsed(!isCollapsed)}>
				${isCollapsed ? expandSvg : collapseSvg}
				${label}
			</div>
			<div
				ref=${contentArea}
				className="collapsible-content ${isCollapsed ? 'collapsed' : 'expanded'}"
				style=${{ 'max-height': isCollapsed ? 0 : contentHeight }}>
				${children}
			</div>
		</div>`;
}

	function Modal({ isOpen, onClose, title, description, children, ...props }) {
		if (!isOpen) {
			return null;
		}
		useEffect(() => {
			const onKeyDown = (event) => {
				if (event.key === 'Escape') {
					onClose();
				}
			};
			document.addEventListener('keydown', onKeyDown);
			return () => {
				document.removeEventListener('keydown', onKeyDown);
			};
		});
		return html`
		<div className="modal-overlay" onClick=${onClose}>
			<div className="modal-container">
				<div className="modal" onClick=${(e) => e.stopPropagation()} ...${props}>
					<div class="modal-title">${title}</div>
					${ description=="" ? false : html`<div style=${{ whiteSpace: 'pre-line' }} class='modal-desc'>${description}</div>` }
					<hr/>
					<div className="modal-content">
						${children}
					</div>
					<button
					class="button-modal-top"
					onClick=${onClose}>
						<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="-1 -1 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M 0 1 L 3 4 L 0 7 L 1 8 L 4 5 L 7 8 L 8 7 L 5 4 L 8 1 L 7 0 L 4 3 L 1 0 L 1 0 Z"></path></svg>
					</button>
				</div>
			</div>
		</div>
		`;
        
	}

	
      

function Sessions({ sessionStorage, onSessionChange, disabled }) {
	const [version, setVersion] = useState(0);
	const [newSessionName, setNewSessionName] = useState('');
	const [renameSessionName, setRenameSessionName] = useState('');
	const [renamingId, setRenamingId] = useState(undefined);
	const [isCreating, setIsCreating] = useState(false);

	useEffect(() => {
		sessionStorage.onchange = () => setVersion(v => v + 1);
		sessionStorage.onsessionchange = onSessionChange;
		return () => {
			sessionStorage.onchange = null;
			sessionStorage.onsessionchange = null;
		};
	}, []);
	
   
	const switchSession = async (sessionId) => {
		if (sessionStorage.selectedSession != sessionId) {
			await sessionStorage.switchSession(sessionId);
		}
	};

	const startRenameSession = (sessionId, name) => {
		setRenameSessionName(name);
		setRenamingId(sessionId);
	};

	const renameSession = async (sessionId) => {
		if (renameSessionName) {
			await sessionStorage.renameSession(sessionId, renameSessionName);
			setRenamingId(undefined);
		}
	};

	const deleteSession = async (sessionId) => {
		await sessionStorage.deleteSession(sessionId);
	};

	const startCreateSession = () => {
		setNewSessionName(`MikuPad #${sessionStorage.nextId + 1}`);
		setIsCreating(true);
	};

	const createSession = async () => {
		if (newSessionName) {
			const newId = await sessionStorage.createSession(newSessionName);
			await sessionStorage.switchSession(newId);
			setIsCreating(false);
		}
	};

	const importSession = () => {
		const fileInput = document.createElement("input");
		fileInput.type = 'file';
		fileInput.style.display = 'none';
		fileInput.onchange = (e) => {
			const file = e.target.files[0];
			if (!file)
				return;
			const reader = new FileReader();
			reader.onload = (e) => {
				const contents = e.target.result;
				fileInput.func(contents);
			}
			reader.readAsText(file);
		};
		fileInput.func = async (text) => {
			const newId = await sessionStorage.createSessionFromObject(JSON.parse(text), false);
			await sessionStorage.switchSession(newId);
		};
		document.body.appendChild(fileInput);
		fileInput.click();
		document.body.removeChild(fileInput);
	};

	const exportSession = () => {
		var element = document.createElement('a');
		const sessionObj = { ...sessionStorage.sessions[sessionStorage.selectedSession] };
		for (const [key, value] of Object.entries(sessionObj)) {
			// This is done for compatibility with localStorage export files.
			sessionObj[key] = JSON.stringify(value);
		}
		element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(JSON.stringify(sessionObj)));
		element.setAttribute('download', `${sessionStorage.getProperty('name')}.json`);
		element.style.display = 'none';
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
	};

	const cloneSession = async () => {
		const sessionObj = { ...sessionStorage.sessions[sessionStorage.selectedSession] };
		for (const [key, value] of Object.entries(sessionObj)) {
			// This is done for compatibility with localStorage export files.
			sessionObj[key] = JSON.stringify(value);
		}
		const newId = await sessionStorage.createSessionFromObject(sessionObj, true);
		await sessionStorage.switchSession(newId);
	};

	function handleKeyDown(sessionId, key) {
		if (event.key === 'Enter') {
			if (isCreating)
				createSession();
			else if (renamingId !== undefined)
				renameSession(sessionId);
		} else if (event.key === 'Escape') {
			if (isCreating)
				setIsCreating(false);
			else if (renamingId !== undefined)
				setRenamingId(undefined);
		}
	}
	


	const trashSvg = html`<svg fill="var(--color-light)" width="16" height="16" viewBox="0 0 490.646 490.646"><path d="m399.179 67.285-74.794.033L324.356 0 166.214.066l.029 67.318-74.802.033.025 62.914h307.739l-.026-63.046zM198.28 32.11l94.03-.041.017 35.262-94.03.041-.017-35.262zM91.465 490.646h307.739V146.359H91.465v344.287zm225.996-297.274h16.028v250.259h-16.028V193.372zm-80.14 0h16.028v250.259h-16.028V193.372zm-80.141 0h16.028v250.259H157.18V193.372z"/></svg>`;
	const renameSvg = html`<svg fill="var(--color-light)" width="16" height="16" viewBox="0 0 512 448"><path style=${{ fillOpacity: 1, stroke: 'none', strokeWidth: 30, strokeLinecap: 'round', strokeMiterlimit: 4, strokeDasharray: 'none', strokeOpacity: 1 }} d="M0 96v256h320v-32H32V128h288V96H0zM416 96v32h64v192h-64v32h96V96h-96z" /><path style=${{ fillOpacity: 1, stroke: 'none', strokeWidth: 30, strokeLinecap: 'round', strokeMiterlimit: 4, strokeDasharray: 'none', strokeOpacity: 1 }} d="M352 636.362h32v384h-32z" transform="matrix(1, 0, 0, 1, 0, -604.3619995117188)" /><path style=${{ fillOpacity: 1, stroke: 'none', strokeWidth: 30, strokeLinecap: 'round', strokeMiterlimit: 4, strokeDasharray: 'none', strokeOpacity: 1 }} transform="matrix(0, 1, -1, 0, 0, -604.3619995117188)" d="M1020.362-448h32v64h-32zM1020.362-352h32v64h-32zM604.362-448h32v64h-32zM604.362-352h32v64h-32zM764.362-288h128v224h-128z" /></svg>`;

	const confirmSvg = html`<svg width="16" height="16" viewBox="0 0 128 128"><circle cx="64" cy="64" r="64" fill="var(--color-dark)"/><path d="M54.3 97.2 24.8 67.7c-.4-.4-.4-1 0-1.4l8.5-8.5c.4-.4 1-.4 1.4 0L55 78.1l38.2-38.2c.4-.4 1-.4 1.4 0l8.5 8.5c.4.4.4 1 0 1.4L55.7 97.2c-.4.4-1 .4-1.4 0z" fill="var(--color-light)"/></svg>`;
	const cancelSvg = html`<svg width="16" height="16" viewBox="0 0 128 128"><circle cx="64" cy="64" r="64" fill="var(--color-dark)"/><path d="M100.3 90.4 73.9 64l26.3-26.4c.4-.4.4-1 0-1.4l-8.5-8.5c-.4-.4-1-.4-1.4 0L64 54.1 37.7 27.8c-.4-.4-1-.4-1.4 0l-8.5 8.5c-.4.4-.4 1 0 1.4L54 64 27.7 90.3c-.4.4-.4 1 0 1.4l8.5 8.5c.4.4 1.1.4 1.4 0L64 73.9l26.3 26.3c.4.4 1.1.4 1.5.1l8.5-8.5c.4-.4.4-1 0-1.4z" fill="var(--color-light)"/></svg>`;

	return html`
	<p>Your stories</p>
		<div className="Sessions ${disabled ? 'disabled' : ''}">
			<ul>
				${isCreating && html`
					<li key=-1>
						<a className="Session">
							<input
								type="text"
								value=${newSessionName}
								onChange=${(e) => setNewSessionName(e.target.value)}
								onKeyDown=${(e) => handleKeyDown(undefined, e.key)}
								onClick=${(e) => e.stopPropagation()}
								autoFocus
							/>
							<div className="flex-separator"></div>
							<button onClick=${(e) => (createSession(), e.stopImmediatePropagation?.())}>${confirmSvg}</button>
							<button onClick=${(e) => (setIsCreating(false), e.stopImmediatePropagation?.())}>${cancelSvg}</button>
						</a>
					</li>
				`}
				${Object.entries(sessionStorage.sessions).reverse().map(([sessionId, session]) => html`
					<li key=${sessionId}>
						<a className="Session ${sessionStorage.selectedSession == sessionId ? 'selected' : ''}"
							onClick=${() => switchSession(+sessionId)}>
							${renamingId == sessionId ? html`
								<input
									type="text"
									value=${renameSessionName}
									onChange=${(e) => setRenameSessionName(e.target.value)}
									onKeyDown=${(e) => handleKeyDown(+sessionId, e.key)}
									onClick=${(e) => e.stopPropagation()}
									autoFocus
								/>
								<div className="flex-separator"></div>
								<button onClick=${(e) => (renameSession(+sessionId), e.stopImmediatePropagation())}>${confirmSvg}</button>
								<button onClick=${(e) => (setRenamingId(undefined), e.stopImmediatePropagation())}>${cancelSvg}</button>
							` : html`
								${session.name}
								<div className="flex-separator"></div>
								<button
									onClick=${(e) => (startRenameSession(+sessionId, session.name), e.stopPropagation())}>
									${renameSvg}
								</button>
								<button
									onClick=${(e) => (deleteSession(+sessionId), e.stopPropagation())}>
									${trashSvg}
								</button>
							`}
						</a>
					</li>
				`)}
				
			</ul>
			<div className="vbox">
					<button disabled=${disabled} onClick=${startCreateSession}>Create</button>
					<button disabled=${disabled} onClick=${importSession}>Import</button>
					<button disabled=${disabled} onClick=${exportSession}>Export</button>
					<button disabled=${disabled} onClick=${cloneSession}>Clone</button>
				</div>
		</div>`;

}

class SessionStorage {
	constructor(defaultPresets) {
		this.dbName = 'MikuPad';
		this.storeName = 'Sessions';
		this.nextId = undefined;
		this.dependents = {};
		this.saveQueue = [];
		this.saveTimer = undefined;
		this.sessions = {};
		this.selectedSession = undefined;
		this.sessionTemplate = { ...defaultPresets };
		this.onchange = null;
		this.onsessionchange = null;
	}

	async init() {
		try {
			const db = await this.openDatabase();
			this.nextId = (await this.loadFromDatabase(db, 'nextSessionId')) || 0;
			this.selectedSession = (await this.loadFromDatabase(db, 'selectedSessionId')) || 0;
			await this.loadSessions(db);
			this.saveTimer = setInterval(async () => await this.saveTimerHandler(), 500);
		} catch (e) {
			reportError(e);
		}
	}

	async openDatabase() {
		return new Promise((resolve, reject) => {
			const openRequest = indexedDB.open(this.dbName);

			openRequest.onerror = () => reject(openRequest.error);
			openRequest.onsuccess = () => resolve(openRequest.result);
			openRequest.onupgradeneeded = (event) => {
				const db = event.target.result;
				db.createObjectStore(this.storeName);
			};
			openRequest.onblocked = () => console.warn('Request was blocked');
		});
	}

	async getNewId() {
		this.nextId += 1;
		await this.saveToDatabase('nextSessionId', this.nextId);
		return this.nextId - 1;
	}

	addDependent(name, callback) {
		this.dependents[name] = this.dependents[name] || new Set();
		this.dependents[name].add(callback);
	}

	updateDependents(name, newValue) {
		if (!this.dependents[name])
			return;
		for (const callback of this.dependents[name]) {
			callback(newValue);
		}
	}

	async saveTimerHandler() {
		while (this.saveQueue.length) {
			const sessionId = this.saveQueue.pop();
			if (!this.sessions[sessionId])
				continue;
			await this.saveToDatabase(sessionId, this.sessions[sessionId]);
		}
	}

	async loadFromDatabase(db, key) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, 'readonly');
			const store = tx.objectStore(this.storeName);
			const request = store.get(key);

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async saveToDatabase(key, data) {
		const db = await this.openDatabase();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, 'readwrite');
			const store = tx.objectStore(this.storeName);
			const request = store.put(data, key);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	// We leave the localStorage content untouched for now,
	// but we might want to erase it in the future.
	async migrateSessions() {
		const nextId = +localStorage.getItem('nextSessionId');
		if (nextId == 0)
			return false;
		this.nextId = nextId;
		this.selectedSession = +localStorage.getItem('selectedSessionId');
		for (const key of Object.keys(localStorage)) {
			const [sessionId, propertyName] = key.split('/');
			if (propertyName === undefined) continue;
			let value = localStorage.getItem(key);
			try {
				value = JSON.parse(value);
			} catch {
				// This might have been added to the localStorage by a extension rather than us. Let's just skip it.
				continue;
			}
			if (value !== null) {
				this.sessions[sessionId] = this.sessions[sessionId] || {};
				this.sessions[sessionId][propertyName] = value;
			}
		};
		await this.saveToDatabase('nextSessionId', this.nextId);
		await this.saveToDatabase('selectedSessionId', this.selectedSession);
		for (const sessionId of Object.keys(this.sessions)) {
			await this.saveToDatabase(+sessionId, this.sessions[sessionId]);
		}
		return true;
	}

	async loadSessions(db) {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, 'readonly');
			const store = tx.objectStore(this.storeName);
			const request = store.openCursor();

			request.onsuccess = async (event) => {
				const cursor = event.target.result;
				if (cursor) {
					if (cursor.key !== 'nextSessionId' && cursor.key !== 'selectedSessionId') {
						this.sessions[cursor.key] = cursor.value;
					}
					cursor.continue();
				} else {
					if (Object.keys(this.sessions).length === 0) {
						if (!await this.migrateSessions()) {
							await this.createSession('MikuPad #1');
						}
					}
					await this.switchSession(this.selectedSession);
					resolve();
				}
			};
			request.onerror = () => reject(request.error);
		});
	}

	getProperty(propertyName) {
		return this.sessions[this.selectedSession]?.[propertyName];
	}

	setProperty(propertyName, value) {
		if (!this.sessions[this.selectedSession])
			return;
		this.sessions[this.selectedSession][propertyName] = value;
		if (!this.saveQueue.includes(this.selectedSession))
			this.saveQueue.push(this.selectedSession);
	}

	async switchSession(sessionId) {
		if (!this.sessions[sessionId])
			return;
		this.selectedSession = +sessionId;
		await this.saveToDatabase('selectedSessionId', this.selectedSession);

		this.onchange?.();
		this.onsessionchange?.();

		const deepCopy = (value) => JSON.parse(JSON.stringify(value));
		for (const propertyName of Object.keys(this.sessionTemplate)) {
			this.updateDependents(propertyName, this.getProperty(propertyName) ?? deepCopy(this.sessionTemplate[propertyName]));
		}
	}

	async renameSession(sessionId, renameSessionName) {
		this.sessions[sessionId]['name'] = renameSessionName;
		await this.saveToDatabase(sessionId, this.sessions[sessionId]);

		this.onchange?.();
	}

	async deleteSession(sessionId) {
		if (Object.keys(this.sessions).length === 1)
			return;
		if (!window.confirm("Are you sure you want to delete this session? This action can't be undone."))
			return;
		const db = await this.openDatabase();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(this.storeName, 'readwrite');
			const store = tx.objectStore(this.storeName);
			const request = store.delete(sessionId);

			request.onsuccess = async () => {
				// Select another session if the current was deleted
				if (sessionId == this.selectedSession) {
					const sessionIds = Object.keys(this.sessions).map(x => +x);
					const sessionIdx = sessionIds.indexOf(sessionId);
					const newSessionId = sessionIds[sessionIdx - 1] ?? sessionIds[sessionIdx + 1];
					await this.switchSession(+newSessionId)
				}

				delete this.sessions[sessionId];
				this.onchange?.();
				resolve();
			};
			request.onerror = () => reject(request.error);
		});
	}

	async createSession(newSessionName) {
		const newId = await this.getNewId();
		this.sessions[newId] = { name: newSessionName };
		await this.saveToDatabase(newId, this.sessions[newId]);

		onchange?.();
		return newId;
	}

	async createSessionFromObject(obj, cloned) {
		const newId = await this.getNewId();
		this.sessions[newId] = {};

		for (const [propertyName, value] of Object.entries(obj)) {
			if (propertyName === 'darkMode') continue;
			this.sessions[newId][propertyName] = JSON.parse(value);
		}

		if (!this.sessions[newId].hasOwnProperty('name')) {
			this.sessions[newId]['name'] = `MikuPad #${this.nextId + 1}`;
		}

		if (cloned && !this.sessions[newId]['name'].startsWith('Cloned')) {
			this.sessions[newId]['name'] = `Cloned ${this.sessions[newId]['name']}`;
		}

		await this.saveToDatabase(newId, this.sessions[newId]);

		onchange?.();
		return newId;
	}
}

const defaultPrompt = `[INST] <<SYS>>
You are a talented writing assistant. Always respond by incorporating the instructions into expertly written prose that is highly detailed, evocative, vivid and engaging.
<</SYS>>
Write a story about Hatsune Miku and Kagamine Rin. [/INST]  Sure, how about this:
Chapter 1
`;

const defaultPresets = {
	endpoint: 'http://127.0.0.1:8080',
	endpointAPI: 0,
	endpointAPIKey: '',
	endpointModel: '',
	prompt: [{ type: 'user', content: defaultPrompt }],
	seed: -1,
	maxPredictTokens: -1,
	temperature: 0.7,
	dynaTempRange: 0,
	dynaTempExp: 1,
	repeatPenalty: 1.1,
	repeatLastN: 256,
	penalizeNl: false,
	presencePenalty: 0,
	frequencyPenalty: 0,
	topK: 40,
	topP: 0.95,
	typicalP: 1,
	minP: 0,
	tfsZ: 1,
	mirostat: 0,
	mirostatTau: 5.0,
	mirostatEta: 0.1,
	stoppingStrings: "[]",
	ignoreEos: false,
	openaiPresets: false,
	contextLength: 4096,
	tokenRatio: 3.3,
	memoryTokens: ({ "contextOrder":"{memPrefix}{wiPrefix}{wiText}{wiSuffix}{memText}{memSuffix}{prompt}","prefix":"", "text":"", "suffix":""}),
	authorNoteTokens: ({ "prefix":"", "text":"", "suffix":""}),
	authorNoteDepth: 3,
	worldInfo:({
		"mikuPediaVersion": 1,
		"entries": [],
		"prefix": "",
		"suffix": ""
	}),
	scrollTop: 0
};

function joinPrompt(prompt) {
	return prompt.map(p => p.content).join('');
}

function replaceUnprintableBytes(inputString) {
	// Define a regular expression to match unprintable bytes
	const unprintableBytesRegex = /[\0-\x1F\x7F-\x9F\xAD\u0378\u0379\u037F-\u0383\u038B\u038D\u03A2\u0528-\u0530\u0557\u0558\u0560\u0588\u058B-\u058E\u0590\u05C8-\u05CF\u05EB-\u05EF\u05F5-\u0605\u061C\u061D\u06DD\u070E\u070F\u074B\u074C\u07B2-\u07BF\u07FB-\u07FF\u082E\u082F\u083F\u085C\u085D\u085F-\u089F\u08A1\u08AD-\u08E3\u08FF\u0978\u0980\u0984\u098D\u098E\u0991\u0992\u09A9\u09B1\u09B3-\u09B5\u09BA\u09BB\u09C5\u09C6\u09C9\u09CA\u09CF-\u09D6\u09D8-\u09DB\u09DE\u09E4\u09E5\u09FC-\u0A00\u0A04\u0A0B-\u0A0E\u0A11\u0A12\u0A29\u0A31\u0A34\u0A37\u0A3A\u0A3B\u0A3D\u0A43-\u0A46\u0A49\u0A4A\u0A4E-\u0A50\u0A52-\u0A58\u0A5D\u0A5F-\u0A65\u0A76-\u0A80\u0A84\u0A8E\u0A92\u0AA9\u0AB1\u0AB4\u0ABA\u0ABB\u0AC6\u0ACA\u0ACE\u0ACF\u0AD1-\u0ADF\u0AE4\u0AE5\u0AF2-\u0B00\u0B04\u0B0D\u0B0E\u0B11\u0B12\u0B29\u0B31\u0B34\u0B3A\u0B3B\u0B45\u0B46\u0B49\u0B4A\u0B4E-\u0B55\u0B58-\u0B5B\u0B5E\u0B64\u0B65\u0B78-\u0B81\u0B84\u0B8B-\u0B8D\u0B91\u0B96-\u0B98\u0B9B\u0B9D\u0BA0-\u0BA2\u0BA5-\u0BA7\u0BAB-\u0BAD\u0BBA-\u0BBD\u0BC3-\u0BC5\u0BC9\u0BCE\u0BCF\u0BD1-\u0BD6\u0BD8-\u0BE5\u0BFB-\u0C00\u0C04\u0C0D\u0C11\u0C29\u0C34\u0C3A-\u0C3C\u0C45\u0C49\u0C4E-\u0C54\u0C57\u0C5A-\u0C5F\u0C64\u0C65\u0C70-\u0C77\u0C80\u0C81\u0C84\u0C8D\u0C91\u0CA9\u0CB4\u0CBA\u0CBB\u0CC5\u0CC9\u0CCE-\u0CD4\u0CD7-\u0CDD\u0CDF\u0CE4\u0CE5\u0CF0\u0CF3-\u0D01\u0D04\u0D0D\u0D11\u0D3B\u0D3C\u0D45\u0D49\u0D4F-\u0D56\u0D58-\u0D5F\u0D64\u0D65\u0D76-\u0D78\u0D80\u0D81\u0D84\u0D97-\u0D99\u0DB2\u0DBC\u0DBE\u0DBF\u0DC7-\u0DC9\u0DCB-\u0DCE\u0DD5\u0DD7\u0DE0-\u0DF1\u0DF5-\u0E00\u0E3B-\u0E3E\u0E5C-\u0E80\u0E83\u0E85\u0E86\u0E89\u0E8B\u0E8C\u0E8E-\u0E93\u0E98\u0EA0\u0EA4\u0EA6\u0EA8\u0EA9\u0EAC\u0EBA\u0EBE\u0EBF\u0EC5\u0EC7\u0ECE\u0ECF\u0EDA\u0EDB\u0EE0-\u0EFF\u0F48\u0F6D-\u0F70\u0F98\u0FBD\u0FCD\u0FDB-\u0FFF\u10C6\u10C8-\u10CC\u10CE\u10CF\u1249\u124E\u124F\u1257\u1259\u125E\u125F\u1289\u128E\u128F\u12B1\u12B6\u12B7\u12BF\u12C1\u12C6\u12C7\u12D7\u1311\u1316\u1317\u135B\u135C\u137D-\u137F\u139A-\u139F\u13F5-\u13FF\u169D-\u169F\u16F1-\u16FF\u170D\u1715-\u171F\u1737-\u173F\u1754-\u175F\u176D\u1771\u1774-\u177F\u17DE\u17DF\u17EA-\u17EF\u17FA-\u17FF\u180F\u181A-\u181F\u1878-\u187F\u18AB-\u18AF\u18F6-\u18FF\u191D-\u191F\u192C-\u192F\u193C-\u193F\u1941-\u1943\u196E\u196F\u1975-\u197F\u19AC-\u19AF\u19CA-\u19CF\u19DB-\u19DD\u1A1C\u1A1D\u1A5F\u1A7D\u1A7E\u1A8A-\u1A8F\u1A9A-\u1A9F\u1AAE-\u1AFF\u1B4C-\u1B4F\u1B7D-\u1B7F\u1BF4-\u1BFB\u1C38-\u1C3A\u1C4A-\u1C4C\u1C80-\u1CBF\u1CC8-\u1CCF\u1CF7-\u1CFF\u1DE7-\u1DFB\u1F16\u1F17\u1F1E\u1F1F\u1F46\u1F47\u1F4E\u1F4F\u1F58\u1F5A\u1F5C\u1F5E\u1F7E\u1F7F\u1FB5\u1FC5\u1FD4\u1FD5\u1FDC\u1FF0\u1FF1\u1FF5\u1FFF\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2072\u2073\u208F\u209D-\u209F\u20BB-\u20CF\u20F1-\u20FF\u218A-\u218F\u23F4-\u23FF\u2427-\u243F\u244B-\u245F\u2700\u2B4D-\u2B4F\u2B5A-\u2BFF\u2C2F\u2C5F\u2CF4-\u2CF8\u2D26\u2D28-\u2D2C\u2D2E\u2D2F\u2D68-\u2D6E\u2D71-\u2D7E\u2D97-\u2D9F\u2DA7\u2DAF\u2DB7\u2DBF\u2DC7\u2DCF\u2DD7\u2DDF\u2E3C-\u2E7F\u2E9A\u2EF4-\u2EFF\u2FD6-\u2FEF\u2FFC-\u2FFF\u3040\u3097\u3098\u3100-\u3104\u312E-\u3130\u318F\u31BB-\u31BF\u31E4-\u31EF\u321F\u32FF\u4DB6-\u4DBF\u9FCD-\u9FFF\uA48D-\uA48F\uA4C7-\uA4CF\uA62C-\uA63F\uA698-\uA69E\uA6F8-\uA6FF\uA78F\uA794-\uA79F\uA7AB-\uA7F7\uA82C-\uA82F\uA83A-\uA83F\uA878-\uA87F\uA8C5-\uA8CD\uA8DA-\uA8DF\uA8FC-\uA8FF\uA954-\uA95E\uA97D-\uA97F\uA9CE\uA9DA-\uA9DD\uA9E0-\uA9FF\uAA37-\uAA3F\uAA4E\uAA4F\uAA5A\uAA5B\uAA7C-\uAA7F\uAAC3-\uAADA\uAAF7-\uAB00\uAB07\uAB08\uAB0F\uAB10\uAB17-\uAB1F\uAB27\uAB2F-\uABBF\uABEE\uABEF\uABFA-\uABFF\uD7A4-\uD7AF\uD7C7-\uD7CA\uD7FC-\uF8FF\uFA6E\uFA6F\uFADA-\uFAFF\uFB07-\uFB12\uFB18-\uFB1C\uFB37\uFB3D\uFB3F\uFB42\uFB45\uFBC2-\uFBD2\uFD40-\uFD4F\uFD90\uFD91\uFDC8-\uFDEF\uFDFE\uFDFF\uFE1A-\uFE1F\uFE27-\uFE2F\uFE53\uFE67\uFE6C-\uFE6F\uFE75\uFEFD-\uFF00\uFFBF-\uFFC1\uFFC8\uFFC9\uFFD0\uFFD1\uFFD8\uFFD9\uFFDD-\uFFDF\uFFE7\uFFEF-\uFFFB\uFFFE\uFFFF]/g;

	// Replace unprintable bytes with their character codes
	const replacedString = inputString.replace(unprintableBytesRegex, (match) => {
		const charCode = match.charCodeAt(0);
		return `<0x${charCode.toString(16).toUpperCase().padStart(2, '0')}>`;
	});

	return replacedString;
}

function useSessionState(sessionStorage, name, initialState) {
	const savedState = useMemo(() => {
		try {
			return sessionStorage.getProperty(name);
		} catch (e) {
			reportError(e);
			return null;
		}
	}, []);

	const [value, setValue] = useState(savedState ?? initialState);
	sessionStorage.addDependent(name, setValue);

	const updateState = (newValue) => {
		setValue((prevValue) => {
			const updatedValue = typeof newValue === 'function' ? newValue(prevValue) : newValue;
			sessionStorage.setProperty(name, updatedValue);
			return updatedValue;
		});
	};

	return [value, updateState];
}

function usePersistentState(name, initialState) {
	const savedState = useMemo(() => {
		try {
			return JSON.parse(localStorage.getItem(name));
		} catch (e) {
			reportError(e);
			return null;
		}
	}, []);

	const [value, setValue] = useState(savedState ?? initialState);

	const updateState = (newValue) => {
		setValue((prevValue) => {
			const updatedValue = typeof newValue === 'function' ? newValue(prevValue) : newValue;
			localStorage.setItem(name, JSON.stringify(updatedValue));
			return updatedValue;
		});
	};

	return [value, updateState];
}

export function App({ sessionStorage, useSessionState }) {
	const promptArea = useRef();
	const promptOverlay = useRef();
	const undoStack = useRef([]);
	const redoStack = useRef([]);
	const probsDelayTimer = useRef();
	const keyState = useRef({});
	const [currentPromptChunk, setCurrentPromptChunk] = useState(undefined);
	const [undoHovered, setUndoHovered] = useState(false);
	const [showProbs, setShowProbs] = useState(true);
	const [cancel, setCancel] = useState(null);
	const [spellCheck, setSpellCheck] = usePersistentState('spellCheck', false);
	const [attachSidebar, setAttachSidebar] = usePersistentState('attachSidebar', false);
	const [showProbsMode, setShowProbsMode] = usePersistentState('showProbsMode', 0);
	const [highlightGenTokens, setHighlightGenTokens] = usePersistentState('highlightGenTokens', true);
	const [preserveCursorPosition, setPreserveCursorPosition] = usePersistentState('preserveCursorPosition', true);
	const [darkMode, _] = usePersistentState('darkMode', false); // legacy
	const [theme, setTheme] = usePersistentState('theme', darkMode ? 1 : 0);
	const [endpoint, setEndpoint] = useSessionState('endpoint', defaultPresets.endpoint);
	const [endpointAPI, setEndpointAPI] = useSessionState('endpointAPI', defaultPresets.endpointAPI);
	const [endpointAPIKey, setEndpointAPIKey] = useSessionState('endpointAPIKey', defaultPresets.endpointAPIKey);
	const [endpointModel, setEndpointModel] = useSessionState('endpointModel', defaultPresets.endpointModel);
	const [promptChunks, setPromptChunks] = useSessionState('prompt', defaultPresets.prompt);
	const [seed, setSeed] = useSessionState('seed', defaultPresets.seed);
	const [maxPredictTokens, setMaxPredictTokens] = useSessionState('maxPredictTokens', defaultPresets.maxPredictTokens);
	const [temperature, setTemperature] = useSessionState('temperature', defaultPresets.temperature);
	const [dynaTempRange, setDynaTempRange] = useSessionState('dynaTempRange', defaultPresets.dynaTempRange);
	const [dynaTempExp, setDynaTempExp] = useSessionState('dynaTempExp', defaultPresets.dynaTempExp);
	const [repeatPenalty, setRepeatPenalty] = useSessionState('repeatPenalty', defaultPresets.repeatPenalty);
	const [repeatLastN, setRepeatLastN] = useSessionState('repeatLastN', defaultPresets.repeatLastN);
	const [penalizeNl, setPenalizeNl] = useSessionState('penalizeNl', defaultPresets.penalizeNl);
	const [presencePenalty, setPresencePenalty] = useSessionState('presencePenalty', defaultPresets.presencePenalty);
	const [frequencyPenalty, setFrequencyPenalty] = useSessionState('frequencyPenalty', defaultPresets.frequencyPenalty);
	const [topK, setTopK] = useSessionState('topK', defaultPresets.topK);
	const [topP, setTopP] = useSessionState('topP', defaultPresets.topP);
	const [typicalP, setTypicalP] = useSessionState('typicalP', defaultPresets.typicalP);
	const [minP, setMinP] = useSessionState('minP', defaultPresets.minP);
	const [tfsZ, setTfsZ] = useSessionState('tfsZ', defaultPresets.tfsZ);
	const [mirostat, setMirostat] = useSessionState('mirostat', defaultPresets.mirostat);
	const [mirostatTau, setMirostatTau] = useSessionState('mirostatTau', defaultPresets.mirostatTau);
	const [mirostatEta, setMirostatEta] = useSessionState('mirostatEta', defaultPresets.mirostatEta);
	const [ignoreEos, setIgnoreEos] = useSessionState('ignoreEos', defaultPresets.ignoreEos);
	const [openaiPresets, setOpenaiPresets] = useSessionState('openaiPresets', defaultPresets.openaiPresets);
	const [rejectedAPIKey, setRejectedAPIKey] = useState(false);
	const [openaiModels, setOpenaiModels] = useState([]);
	const [tokens, setTokens] = useState(0);
	const [predictStartTokens, setPredictStartTokens] = useState(0);
	const [lastError, setLastError] = useState(undefined);
	const [stoppingStrings, setStoppingStrings] = useSessionState('stoppingStrings', defaultPresets.stoppingStrings);
	const [stoppingStringsError, setStoppingStringsError] = useState(undefined);
	const [savedScrollTop, setSavedScrollTop] = useSessionState('scrollTop', defaultPresets.scrollTop);

	const [contextLength, setContextLength] = useSessionState('contextLength', defaultPresets.contextLength);
	const [memoryTokens, setMemoryTokens] = useSessionState('memoryTokens', defaultPresets.memoryTokens);

	const [authorNoteTokens, setAuthorNoteTokens] = useSessionState('authorNoteTokens', defaultPresets.authorNoteTokens);
	const [authorNoteDepth, setAuthorNoteDepth] = useSessionState('authorNoteDepth', defaultPresets.authorNoteDepth);

	const handleAuthorNoteDepthChange = (value) => {
		setAuthorNoteDepth(!isNaN(+value) && value >= 0 ? value : 0);
	};

	function handleauthorNoteTokensChange(key,value) {
		setAuthorNoteTokens((prevauthorNoteTokens) => ({ ...prevauthorNoteTokens, [key]: value }));
	}
	function handleMemoryTokensChange(key,value) {
		setMemoryTokens((prevMemoryTokens) => ({ ...prevMemoryTokens, [key]: value }));
	}

	// world info
	const [worldInfo, setWorldInfo] = useSessionState('worldInfo', defaultPresets.worldInfo)

	const handleWorldInfoNew = () => {
		setWorldInfo((prevWorldInfo) => {
			return {
				...prevWorldInfo,
				entries: [ { "displayName":"New Entry","text":"","keys":[], "search":"" },...prevWorldInfo.entries ],
			};
		});
	}
	const handleWorldInfoMove = (index,move) => {
		const modEntries = worldInfo.entries
		if (index+move < 0 || index+move > modEntries.length-1 ) {
			return
		}
		modEntries.splice(index+move, 0, modEntries.splice(index, 1)[0])
		setWorldInfo((prevWorldInfo) => {
		 return {
			 ...prevWorldInfo,
			 entries: [ ...modEntries ],
		 };
		});
	}
	const handleWorldInfoDel = (index) => {
		if (!window.confirm("Are you sure you want to delete the world info entry #" + (index + 1) + ": "+ worldInfo.entries[index].displayName + "?\nThis action cannot be undone."))
			return;
		if (index > -1 && index < worldInfo.entries.length) {
			setWorldInfo((prevWorldInfo) => {
				console.warn(`Deleting world info entry #${(index + 1)}:`,prevWorldInfo.entries[index])
				return {
					...prevWorldInfo,
					entries: prevWorldInfo.entries.filter((_, i) => i !== index),
				};
			});
		}
		else {
			alert("Index " + index + " out of range!")
		}
	};

	const handleWorldInfoChange = (key,index,value) => {
		setWorldInfo((prevWorldInfo) => {
			const updatedEntries = [...prevWorldInfo.entries];
			const updatedEntry = key == "keys"
				? { ...updatedEntries[index], [key]: value.split(/(?<!\\), ?/) } //.map(item => item.trim())
				: { ...updatedEntries[index], [key]: value };
			updatedEntries[index] = updatedEntry;

			return {
				...prevWorldInfo,
				entries: updatedEntries,
			};
		});
	}
	const handleWorldInfoAffixChange = (key, value) => {
		setWorldInfo((prevWorldInfo) => ({
			...prevWorldInfo,
			[key]: value,
		}));
	}

	const [modalState, setModalState] = useState({});
	const toggleModal = (modalKey) => {
		setModalState((prevState) => ({
			...prevState,
			[modalKey]: !prevState[modalKey],
		}));
	};
	const closeModal = (modalKey) => {
		setModalState((prevState) => ({
			...prevState,
			[modalKey]: false,
		}));
	};

	const promptText = useMemo(() => joinPrompt(promptChunks), [promptChunks]);

	// compute separately as I imagine this can get expensive
	const assembledWorldInfo = useMemo(() => {
		// assemble non-empty wi
		const validWorldInfo = !Array.isArray(worldInfo.entries) ? [] : worldInfo.entries.filter(entry =>
			entry.keys.length > 0 && !(entry.keys.length == 1 && entry.keys[0] == "") && entry.text !== "");

		// search prompt
		const activeWorldInfo = validWorldInfo.filter(entry => {
			if (validWorldInfo.length < 1) { return }
			// default to 2048
			const searchRange = isNaN(entry.search) || entry.search === ""
				? 2048
				: Number(entry.search);

			// truncate to search range. using promptText allows for search ranges larger than context
			const searchPrompt = promptText.substring(promptText.length - searchRange * defaultPresets.tokenRatio);

			// search in range
			return entry.keys.some((key, index) => {
				// don't waste resources on disabled entries
				if (searchPrompt.length == 0) {
					return
				}

				// an invalid regex here can completely lock you out of mikupad until you clear
				// localStorage, so this is necessary to handle that.
				try {
					return new RegExp(key, "i").test(searchPrompt) && key !== "";
				}
				catch (error) {
					console.error(`Error in RegEx for key '${key}': ${error.message}`);
					return false;
				}
			});
		});

		const assembledWorldInfo = activeWorldInfo.length > 0
			? activeWorldInfo.map(entry => entry.text).join("\n")
			: "";

		return assembledWorldInfo
	}, [worldInfo]);

	const modifiedPrompt = useMemo(() => {
		// add world info to memory for easier assembly
		memoryTokens["worldInfo"] = assembledWorldInfo;

		const order = ["prefix","text","suffix"]
		const assembledAuthorNote = authorNoteTokens.text && authorNoteTokens.text !== ""
			? order.map(key => authorNoteTokens[key]).join("").replace(/\\n/g,'\n')
			: "";

		// replacements for the contextOrder string
		const replacements = {
			"{wiPrefix}": memoryTokens.worldInfo && memoryTokens.worldInfo !== ""
				? worldInfo.prefix
				: "", // wi prefix and suffix will be added whenever wi isn't empty
			"{wiText}": memoryTokens.worldInfo,
			"{wiSuffix}": memoryTokens.worldInfo && memoryTokens.worldInfo !== ""
				? worldInfo.suffix
				: "",

			"{memPrefix}": memoryTokens.text && memoryTokens.text !== "" || memoryTokens.worldInfo !== ""
				? memoryTokens.prefix
				: "", // memory prefix and suffix will be added whenever memory or wi aren't empty
			"{memText}": memoryTokens.text,
			"{memSuffix}": memoryTokens.text && memoryTokens.text !== "" || memoryTokens.worldInfo !== ""
				? memoryTokens.suffix
				: "",
		}

		// prompt length estimation
		const additionalContext = (Object.values(replacements)
			.filter(value => typeof value === 'string').join('')).length;
		const estimatedContextStart = Math.round(
			promptText.length - contextLength * defaultPresets.tokenRatio + additionalContext) + 1;

		// trunkate prompt to context limit
		const truncPrompt = promptText.substring(estimatedContextStart);

		// make injection depth valid
		const truncPromptLen = truncPrompt.split('\n').length;
		const injDepth = truncPromptLen > authorNoteDepth ? authorNoteDepth : truncPromptLen

		const lines = truncPrompt.match(/.*\n?/g);
		const injIndex = lines.length-injDepth-1
		// inject an
		lines.splice(injIndex,0,assembledAuthorNote)
		// if an, return an context, else return original truncated context
		const authorNotePrompt = assembledAuthorNote != ""
			? lines.join('')
			: truncPrompt;

		// add the final replacement
		replacements["{prompt}"] = authorNotePrompt

		const workingContextOrder = memoryTokens.contextOrder && memoryTokens.contextOrder !== ""
			? memoryTokens.contextOrder
			: defaultPresets.memoryTokens.contextOrder;

		// assemble context in order:
		// the context is (1) split by line, (2) all placeholders get replaced,
		// (3) non-empty lines are joined back together.
				const permContextPrompt = workingContextOrder.split("\n").map(function (line) {
				return line.replace(/\{[^}]+\}/g, function (placeholder) {
		return replacements.hasOwnProperty(placeholder)
			? replacements[placeholder]
			: placeholder;
				});
		}).filter(function (line) {
				return line.trim() !== "";
		}).join("\n").replace(/\\n/g, '\n');

		return permContextPrompt;

		
		
  
	}, [contextLength, promptText, memoryTokens, authorNoteTokens, authorNoteDepth, assembledWorldInfo, worldInfo.prefix, worldInfo.suffix]);


	function setBackground() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
	
		input.addEventListener('change', function() {
			if (this.files && this.files[0]) {
				const reader = new FileReader();
				reader.onload = function(e) {
					const imgUrl = e.target.result;
					localStorage.setItem('bgImage', imgUrl);
					applyBackgroundImage(imgUrl);
					document.documentElement.classList.add('custom-bg');
				};
				reader.readAsDataURL(this.files[0]);
			}
		});
	
		input.click();
	}
	
	function applyBackgroundImage(imageUrl) {
		document.body.style.backgroundImage = `url(${imageUrl})`;
		document.body.style.backgroundSize = 'cover';
		document.body.style.backgroundPosition = 'center';
	}
	
	function loadBackgroundFromStorage() {
		const storedImage = localStorage.getItem('bgImage');
		if (storedImage) {
			applyBackgroundImage(storedImage);
			document.documentElement.classList.add('custom-bg');
		} else {
			document.documentElement.classList.remove('custom-bg');
		}
	}
	
	window.onload = loadBackgroundFromStorage;
	
	
	async function predict(prompt = modifiedPrompt, chunkCount = promptChunks.length) {
		if (cancel) {
			cancel?.();

			// llama.cpp server sometimes generates gibberish if we stop and
			// restart right away (???)
			let cancelled = false;
			setCancel(() => () => cancelled = true);
			await new Promise(resolve => setTimeout(resolve, 500));
			if (cancelled)
				return;
		}

		const ac = new AbortController();
		const cancelThis = () => {
			abortCompletion({ endpoint, endpointAPI });
			ac.abort();
		};
		setCancel(() => cancelThis);
		setLastError(undefined);

		try {
			// sometimes "getTokenCount" can take a while because the server is busy
			// so let's set the predictStartTokens beforehand.
			setPredictStartTokens(tokens);

			const tokenCount = await getTokenCount({
				endpoint,
				endpointAPI,
				...(endpointAPI == 3 || endpointAPI == 0 || endpointAPI == 4 ? { endpointAPIKey } : {}),
				content: ` ${prompt}`,
				signal: ac.signal,
			});	
			setTokens(tokenCount);
			setPredictStartTokens(tokenCount);

			while (undoStack.current.at(-1) >= chunkCount)
				undoStack.current.pop();
			undoStack.current.push(chunkCount);
			redoStack.current = [];
			setUndoHovered(false);
			setRejectedAPIKey(false);

			for await (const chunk of completion({
				endpoint,
				endpointAPI,
				...(endpointAPI == 3 || endpointAPI == 0 || endpointAPI == 4 ? {
					endpointAPIKey,
					model: endpointModel
				} : {}),
				prompt,
				...(seed != -1 ? { seed } : {}),
				temperature,
				...(!openaiPresets || endpointAPI != 3 || endpointAPI != 4 ? {
					dynatemp_range: dynaTempRange,
					dynatemp_exponent: dynaTempExp,
					repeat_penalty: repeatPenalty,
					repeat_last_n: repeatLastN,
					penalize_nl: penalizeNl,
					ignore_eos: ignoreEos,
				} : {}),
				presence_penalty: presencePenalty,
				frequency_penalty: frequencyPenalty,
				...((mirostat && (!openaiPresets || endpointAPI != 3 || endpointAPI != 4)) ? {
					mirostat,
					mirostat_tau: mirostatTau,
					mirostat_eta: mirostatEta,
				} : {
					top_p: topP,
					...(!openaiPresets || endpointAPI != 3 || endpointAPI != 4 ? {
						top_k: topK,
						typical_p: typicalP,
						min_p: minP,
						tfs_z: tfsZ
					} : {})
				}),
				n_predict: maxPredictTokens,
				n_probs: 10,
				stop: JSON.parse(stoppingStrings) || [],
				signal: ac.signal,
			})) {
				ac.signal.throwIfAborted();
				if (chunk.stopping_word)
					chunk.content = chunk.stopping_word;
				if (!chunk.content)
					continue;
				setPromptChunks(p => [...p, chunk]);
				setTokens(t => t + (chunk?.completion_probabilities?.length ?? 1));
				chunkCount += 1;
			}
		} catch (e) {
			if (e.name !== 'AbortError') {
				reportError(e);
				const errStr = e.toString();
				if ((endpointAPI == 3 || endpointAPI == 0 || endpointAPI == 4 ) && errStr.includes("401")) {
					setLastError("Error: Rejected API Key");
					setRejectedAPIKey(true);
				} else if (endpointAPI == 3 && errStr.includes("429")) {
					setLastError("Error: Insufficient Quota");
				} else {
					setLastError(errStr);
				}
			}
			return false;
		} finally {
			setCancel(c => c === cancelThis ? null : c);
			if (undoStack.current.at(-1) === chunkCount)
				undoStack.current.pop();
		}
	}

	function undo() {
		if (!undoStack.current.length)
			return false;
		redoStack.current.push(promptChunks.slice(undoStack.current.at(-1)));
		setPromptChunks(p => p.slice(0, undoStack.current.pop()));
		return true;
	}

	function redo() {
		if (!redoStack.current.length)
			return false;
		undoStack.current.push(promptChunks.length);
		setPromptChunks(p => [...p, ...redoStack.current.pop()]);
		setUndoHovered(false);
		return true;
	}

	const [triggerPredict, setTriggerPredict] = useState(false);

	function undoAndPredict() {
		if (!undoStack.current.length) return;
		const didUndo = undo();
		if (didUndo) {
			setTriggerPredict(true);
		}
	}

	useEffect(() => {
		if (triggerPredict) {
			predict();
			setTriggerPredict(false);
		}
	}, [triggerPredict, predict]);

	useLayoutEffect(() => {
		if (attachSidebar)
			document.body.classList.add('attachSidebar');
		else
			document.body.classList.remove('attachSidebar');
	}, [attachSidebar]);

	  
	useLayoutEffect(() => {
		document.documentElement.classList.remove('serif-dark');
		document.documentElement.classList.remove('monospace-dark');
		document.documentElement.classList.remove('nockoffAI');
        document.documentElement.classList.remove('infermatic');
		switch (theme) {
		case 1:
			document.documentElement.classList.add('serif-dark');
			break;
		case 2:
			document.documentElement.classList.add('monospace-dark');
			break;
		case 3:
			document.documentElement.classList.add('nockoffAI');
			break;

        case 4:
			document.documentElement.classList.add('infermatic');
			break;
		}
	}, [theme]);


	useEffect(() => {
		try {
			JSON.parse(stoppingStrings);
			setStoppingStringsError(undefined);
		} catch (e) {
			setStoppingStringsError(e.toString());
		}
	}, [stoppingStrings]);

	useEffect(() => {
		if (showProbsMode === -1)
			return;

		const adjustProbsPosition = () => {
			const probsElement = document.getElementById('probs');
			if (!probsElement) return;

			probsElement.style.display = '';
			probsElement.style.setProperty('--probs-top', `${currentPromptChunk.top}px`);
			probsElement.style.setProperty('--probs-left', `${currentPromptChunk.left}px`);

			const probsRect = probsElement.getBoundingClientRect();
			const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
			const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

			// Adjust left position if element goes off-screen on the right
			if (probsRect.right > viewportWidth) {
				const newLeft = viewportWidth - probsRect.width / 2;
				probsElement.style.setProperty('--probs-left', `${newLeft}px`);
			}

			// Adjust right position if element goes off-screen on the left
			if (probsRect.left < 0) {
				probsElement.style.setProperty('--probs-left', `${probsRect.width / 2}px`);
			}
		};

		if (currentPromptChunk && showProbs) {
			setTimeout(() => {
				adjustProbsPosition();
			});
		}
	}, [currentPromptChunk, showProbs]);

	// Update the textarea in an uncontrolled way so the user doesn't lose their
	// selection or cursor position during prediction
	useLayoutEffect(() => {
		const elem = promptArea.current;
		if (elem.value === promptText) {
			return;
		} else if (elem.value.length && promptText.startsWith(elem.value)) {
			const isTextSelected = elem.selectionStart !== elem.selectionEnd;
			const oldHeight = elem.scrollHeight;
			const atBottom = (elem.scrollTarget ?? elem.scrollTop) + elem.clientHeight + 1 > oldHeight;
			const oldLen = elem.value.length;
			if (!isTextSelected && !preserveCursorPosition) {
				elem.value = promptText;
			} else {
				elem.setRangeText(promptText.slice(oldLen), oldLen, oldLen, 'preserve');
			}
			const newHeight = elem.scrollHeight;
			if (atBottom && oldHeight !== newHeight) {
				elem.scrollTarget = newHeight - elem.clientHeight;
				elem.scrollTo({
					top: newHeight - elem.clientHeight,
					behavior: 'smooth',
				});
			}
		} else {
			elem.value = promptText;
		}
	}, [promptText]);

	useLayoutEffect(() => {
		if (cancel)
			return;
		promptArea.current.scrollTarget = undefined;
		promptArea.current.scrollTop = savedScrollTop;
		promptOverlay.current.scrollTop = savedScrollTop;
	}, [savedScrollTop, highlightGenTokens, showProbsMode]);

	useEffect(() => {
		if (cancel)
			return;
		const ac = new AbortController();
		const to = setTimeout(async () => {
			try {
				const tokenCount = await getTokenCount({
					endpoint,
					endpointAPI,
					...(endpointAPI == 3 || endpointAPI == 0 ? { endpointAPIKey } : {}),
					content: ` ${modifiedPrompt}`,
					signal: ac.signal,
				});
				setTokens(tokenCount);
			} catch (e) {
				if (e.name !== 'AbortError')
					reportError(e);
			}
		}, 500);
		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	}, [promptText, cancel, endpoint, endpointAPI]);

	useEffect(() => {
		if (endpointAPI != 3)
			return;
		setRejectedAPIKey(false);
		const ac = new AbortController();
		const to = setTimeout(async () => {
			try {
				const models = await getModels({
					endpoint,
					endpointAPI,
					...(endpointAPI == 3 ? { endpointAPIKey } : {}),
					signal: ac.signal,
				});
				setOpenaiModels(models);
			} catch (e) {
				if (e.name !== 'AbortError') {
					reportError(e);
					const errStr = e.toString();
					if (endpointAPI == 3 && errStr.includes("401")) {
						setRejectedAPIKey(true);
					}
				}
			}
		}, 500);
		ac.signal.addEventListener('abort', () => clearTimeout(to));
		return () => ac.abort();
	}, [endpoint, endpointAPI, endpointAPIKey]);

	useEffect(() => {
		function onKeyDown(e) {
			const { altKey, ctrlKey, shiftKey, key, defaultPrevented } = e;
			if (defaultPrevented)
				return;
			switch (`${altKey}:${ctrlKey}:${shiftKey}:${key}`) {
			case 'false:false:true:Enter':
			case 'false:true:false:Enter':
				predict();
				break;
			case 'false:false:false:Escape':
				cancel();
				break;
			case 'false:true:false:r':
			case 'false:false:true:r':
				undoAndPredict();
				break;
			case 'false:true:false:z':
			case 'false:false:true:z':
				if (cancel || !undo()) return;
				break;
			case 'false:true:true:Z':
			case 'false:true:false:y':
			case 'false:false:true:y':
				if (cancel || !redo()) return;
				break;

			default:
				keyState.current = e;
				return;
			}
			e.preventDefault();
		}
		function onKeyUp(e) {
			const { altKey, ctrlKey, shiftKey, key, defaultPrevented } = e;
			if (defaultPrevented)
				return;
			keyState.current = e;
		}

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp)
		};
	}, [predict, cancel]);

	function onInput({ target }) {
		setPromptChunks(oldPrompt => {
			const start = [];
			const end = [];
			const oldPromptLength = oldPrompt.length;
			oldPrompt = [...oldPrompt];
			let newValue = target.value;

			while (oldPrompt.length) {
				const chunk = oldPrompt[0];
				if (!newValue.startsWith(chunk.content))
					break;
				oldPrompt.shift();
				start.push(chunk);
				newValue = newValue.slice(chunk.content.length);
			}

			while (oldPrompt.length) {
				const chunk = oldPrompt.at(-1);
				if (!newValue.endsWith(chunk.content))
					break;
				oldPrompt.pop();
				end.unshift(chunk);
				newValue = newValue.slice(0, -chunk.content.length);
			}

			// Remove all undo positions within the modified range.
			undoStack.current = undoStack.current.filter(pos => start.length < pos);
			if (!undoStack.current.length)
				setUndoHovered(false);

			// Update all undo positions.
			if (start.length + end.length + (+!!newValue) !== oldPromptLength) {
				// Reset redo stack if a new chunk is added/removed at the end.
				if (!end.length)
					redoStack.current = [];

				if (!oldPrompt.length)
					undoStack.current = undoStack.current.map(pos => pos + 1);
				else
					undoStack.current = undoStack.current.map(pos => pos - oldPrompt.length);
			}

			const newPrompt = [
				...start,
				...(newValue ? [{ type: 'user', content: newValue }] : []),
				...end,
			];
			return newPrompt;
		});
	}

	function onScroll({ target }) {
		if (target.scrollTop === target.scrollTarget)
			target.scrollTarget = undefined;

		const newTop = target.scrollTop;
		const oldTop = promptOverlay.current.scrollTop;
		promptOverlay.current.scrollTop = target.scrollTop;
		promptOverlay.current.scrollLeft = target.scrollLeft;
		setSavedScrollTop(newTop);

		if (showProbsMode !== -1) {
			const probsElement = document.getElementById('probs');
			if (probsElement) {
				const probsTop = getComputedStyle(probsElement).getPropertyValue('top');
				probsElement.style.setProperty('--probs-top', `calc(${probsTop} + ${oldTop - newTop}px)`);
			} else if (currentPromptChunk) {
				currentPromptChunk.top += oldTop - newTop;
			}
		}
	}

	function onPromptMouseMove({ clientX, clientY }) {
		if (showProbsMode === -1 && !highlightGenTokens)
			return;
		promptOverlay.current.style.pointerEvents = 'auto';
		const elem = document.elementFromPoint(clientX, clientY);
		const pc = elem?.closest?.('[data-promptchunk]');
		const probs = elem?.closest?.('#probs');
		promptOverlay.current.style.pointerEvents = 'none';
		if (probs)
			return;
		if (!pc) {
			setCurrentPromptChunk(undefined);
			return;
		}
		const rect = [...pc.getClientRects()].at(-1);
		const index = +pc.dataset.promptchunk;
		const top = rect.top;
		const left = rect.x + rect.width / 2;
		setCurrentPromptChunk(cur => {
			const isCurrent = cur && cur.index === index && cur.top === top && cur.left === left;
			switch (showProbsMode) {
				case 0:
					if (!isCurrent || !showProbs) {
						setShowProbs(false);
						clearTimeout(probsDelayTimer.current);
						probsDelayTimer.current = setTimeout(() => setShowProbs(true), 300);
					}
					break;
				case 1:
					setShowProbs(keyState.current.ctrlKey);
			}
			return isCurrent ? cur : { index, top, left };
		});
	}

	async function switchCompletion(i, tok) {
		const newPrompt = [
			...promptChunks.slice(0, i),
			{
				...promptChunks[i],
				content: tok,
			},
		];
		setPromptChunks(newPrompt);
		setTriggerPredict(true);
	}

	function switchEndpointAPI(value) {
		let url;
		if (endpoint) {
			try {
				url = new URL(endpoint);
			} catch {
				// Handle the invalid URL case here if necessary
				// For now, just print an error and use the default URL structure
				console.error('Invalid URL provided:', endpoint);
			}
		}
		switch (value) {
        case 0: // llama.cpp
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                url.protocol = 'http:';
            }
            url.port = 8080;
            setEndpoint(url.toString());

            break;
        case 2: // koboldcpp
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                url.protocol = 'http:';
            }
            url.port = 5001;
            setEndpoint(url.toString());

            break;
        case 3: // openai-compatible or any other case that does not require changing the endpoint
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                url.protocol = 'http:';
            }
            setEndpoint(url.toString());

            break;
        case 4: // infermaticAPI
            setEndpoint('https://api.totalgpt.ai/');
            break;
    }
	console.log('Endpoint after setting:', endpoint);
    setEndpointAPI(value);
}
	function isMixedContent() {
		const isHttps = window.location.protocol == 'https:';
		let url;
		try {
			url = new URL(endpoint);
		} catch {
			return false;
		}
		return isHttps && (url.protocol !== 'https:' && url.protocol !== 'wss:');
	}

	function onSessionChange() {
		// TODO: Store the undo/redo in the session.
		redoStack.current = [];
		undoStack.current = [];
		setUndoHovered(false);
	}

	const probs = useMemo(() =>
		showProbs && promptChunks[currentPromptChunk?.index]?.completion_probabilities?.[0]?.probs,
		[promptChunks, currentPromptChunk, showProbs]);

	return html`
	
	<div id="sidebar2" >
			<img class='infermatic_logo' src=${infermaticLogo} alt="infermatic logo"/>
			<${SelectBox}
				label="Theme"
				value=${theme}
				onValueChange=${setTheme}
				options=${[
					{ name: 'Serif Light', value: 0 },
					{ name: 'Serif Dark', value: 1 },
					{ name: 'Monospace Dark', value: 2 },
					{ name: 'nockoffAI', value: 3 },
					{ name: 'Infermatic', value: 4 },
				]}/>
			<div class="horz-separator"/>
			<container>
				<${Sessions} sessionStorage=${sessionStorage}
					disabled=${!!cancel}
					onSessionChange=${onSessionChange}/>
					<button onClick=${setBackground}>Change Background</button>
			</container>
			<${CollapsibleGroup} label="Persistent Context">
				<label className="TextArea">
					Memory
					<textarea
					readOnly=${!!cancel}
					placeholder="Anything written here will be injected at the head of the prompt. Tokens here DO count towards the Context Limit."
					defaultValue=${memoryTokens.text}
					value=${memoryTokens.text}
					onInput=${(e) => handleMemoryTokensChange("text", e.target.value) }
					id="memory-area"/>
					<button
					className="textAreaSettings"
					disabled=${!!cancel}
					onClick=${() => toggleModal("memory")}>
					<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="-1 -5 8 7" xmlns="http://www.w3.org/2000/svg"><path d="M0 0 3-3C3-4 3-5 5-5L4-4 5-3 6-4C6-2 5-2 4-2L1 1C0 2-1 1 0 0"></path></svg>
					</button>
				</label>
				<label className="TextArea">
					Author's Note
					<textarea
					readOnly=${!!cancel}
					placeholder="Anything written here will be injected ${authorNoteDepth} newlines from bottom into context."
					defaultValue=${authorNoteTokens.text}
					value=${authorNoteTokens.text}
					onInput=${(e) => handleauthorNoteTokensChange("text", e.target.value) }
					id="an-area"/>
					<button
					className="textAreaSettings"
					disabled=${!!cancel}
					onClick=${() => toggleModal("an")}>
					<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="-1 -5 8 7" xmlns="http://www.w3.org/2000/svg"><path d="M0 0 3-3C3-4 3-5 5-5L4-4 5-3 6-4C6-2 5-2 4-2L1 1C0 2-1 1 0 0"></path></svg>
					</button>
				</label>
				<button
					id="viewWorldInfo"
					disabled=${!!cancel}
					onClick=${() => toggleModal("wi")}>
					Show World Info
				</button>
				<button
					id="viewContext"
					disabled=${!!cancel}
					onClick=${() => toggleModal("context")}>
					Show Context
				</button>
			</${CollapsibleGroup}>
			${!!tokens && html`
				<${InputBox} label="Tokens" value=${tokens} readOnly/>`}
		
		</div>
		
		<div id="prompt-container" onMouseMove=${onPromptMouseMove}>
		<div id="title-bar">
			<h2 id="session-title">${sessionStorage.sessions[sessionStorage.selectedSession]?.name || 'New Story'}</h2>
		</div>
			<button
			
				className="textAreaSettings"
				onClick=${() => toggleModal("prompt")}>
				<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="-1 -5 8 7" xmlns="http://www.w3.org/2000/svg"><path d="M0 0 3-3C3-4 3-5 5-5L4-4 5-3 6-4C6-2 5-2 4-2L1 1C0 2-1 1 0 0"></path></svg>
			</button>
			<textarea
				useSessionState=${(name)}
				ref=${promptArea}
				readOnly=${!!cancel}
				spellCheck=${spellCheck}
				id="prompt-area"
				onInput=${onInput}
				onScroll=${onScroll}/>
				
			<div ref=${promptOverlay} id="prompt-overlay" aria-hidden>
				${highlightGenTokens || showProbsMode !== -1 ? html`
					${promptChunks.map((chunk, i) => {
						const isCurrent = currentPromptChunk && currentPromptChunk.index === i;
						const isNextUndo = undoHovered && !!undoStack.current.length && undoStack.current.at(-1) <= i;
						return html`
							<span
								key=${i}
								data-promptchunk=${i}
								className=${`${(!highlightGenTokens && !isCurrent) || chunk.type === 'user' ? 'user' : 'machine'} ${isCurrent ? 'current' : ''} ${isNextUndo ? 'erase' : ''}`}>
								${(chunk.content === '\n' ? ' \n' : chunk.content) + (i === promptChunks.length - 1 && chunk.content.endsWith('\n') ? '\u00a0' : '')}
							</span>`;
					})}` : null}
					
			</div>
		

		</div>
		
		
		${probs ? html`
			<div
				id="probs"
				style=${{
					'display': 'none'
				}}>
				${probs.map((prob, i) =>
					html`<button key=${i} onClick=${() => switchCompletion(currentPromptChunk?.index, prob.tok_str)}>
						<div className="tok">${replaceUnprintableBytes(prob.tok_str)}</div>
						<div className="prob">${(prob.prob * 100).toFixed(2)}%</div>
					</button>`)}
			</div>` : null}
		<div id="sidebar">
			<${CollapsibleGroup} label="Parameters" expanded>
				${endpointAPI != 4 && html`
					<${InputBox} label="Server"
						className="${isMixedContent() ? 'mixed-content' : ''}"
						tooltip="${isMixedContent() ? 'This URL might be blocked due to mixed content. If the prediction fails, download mikupad.html and run it locally.' : ''}"
						readOnly=${!!cancel}
						value=${endpoint}
						onValueChange=${setEndpoint}/>
						`}
				<${SelectBox}
					label="API"
					disabled=${!!cancel}
					value=${endpointAPI}
					onValueChange=${switchEndpointAPI}
					options=${[
						{ name: 'llama.cpp', value: 0 },
						/*{ name: 'legacy oobabooga', value: 1 },*/
						{ name: 'koboldcpp', value: 2 },
						{ name: 'openai-compatible', value: 3 },
						{ name: 'infermatic AI', value: 4 },
					]}/>
				${(endpointAPI == 3 || endpointAPI == 0 || endpointAPI == 4 ) && html`
					<${InputBox} label="API Key" type="password"
						className="${rejectedAPIKey ? 'rejected' : ''}"
						tooltip="${rejectedAPIKey ? 'This API Key was rejected by the backend.' : ''}"
						tooltipSize="short"
						readOnly=${!!cancel}
						value=${endpointAPIKey}
						onValueChange=${setEndpointAPIKey}/>`}
				${(endpointAPI == 3 || endpointAPI==4) && html`
					<${InputBox} label="Model"
						datalist=${openaiModels}
						readOnly=${!!cancel}
						value=${endpointModel}
						onValueChange=${setEndpointModel}/>`}
				<${InputBox} label="Seed (-1 = random)" type="text" inputmode="numeric"
					readOnly=${!!cancel} value=${seed} onValueChange=${setSeed}/>
				<${InputBox} tooltip="Currently not accurate to the token count, it will be used as an estimate." label="Max Context Length" type="text" inputmode="numeric"
					readOnly=${!!cancel} value=${contextLength} onValueChange=${setContextLength}/>
				<${InputBox} label="Max Predict Tokens${endpointAPI != 0 ? ' (-1 = 1024)' : ' (-1 = infinite)'}" type="text" inputmode="numeric"
					readOnly=${!!cancel} value=${maxPredictTokens} onValueChange=${setMaxPredictTokens}/>
				<${InputBox} label="Stopping Strings (JSON array)" type="text" pattern="^\\[.*?\\]$"
					className="${stoppingStringsError ? 'rejected' : ''}"
					tooltip="${stoppingStringsError ? stoppingStringsError : ''}"
					readOnly=${!!cancel}
					value=${stoppingStrings}
					onValueChange=${setStoppingStrings}/>
			</${CollapsibleGroup}>
			<${CollapsibleGroup} label="Sampling" expanded>
				${(endpointAPI == 3 || endpointAPI == 4) && html`
					<${Checkbox} label="Full OpenAI compliance"
						disabled=${!!cancel} value=${openaiPresets} onValueChange=${setOpenaiPresets}/>`}
				<${InputBox} label="Temperature" type="number" step="0.01"
					readOnly=${!!cancel} value=${temperature} onValueChange=${setTemperature}/>
				${(!openaiPresets || endpointAPI != 3 || endpointAPI != 4) && html`
					<div className="hbox">
						<${InputBox} label="DynaTemp Range" type="number" step="0.01"
							readOnly=${!!cancel} value=${dynaTempRange} onValueChange=${setDynaTempRange}/>
						${(endpointAPI != 2) && html`
							<${InputBox} label="DynaTemp Exp" type="number" step="0.01"
								readOnly=${!!cancel} value=${dynaTempExp} onValueChange=${setDynaTempExp}/>`}
					</div>
					<div className="hbox">
						<${InputBox} label="Repeat penalty" type="number" step="0.01"
							readOnly=${!!cancel} value=${repeatPenalty} onValueChange=${setRepeatPenalty}/>
						<${InputBox} label="Repeat last n" type="number" step="1"
							readOnly=${!!cancel} value=${repeatLastN} onValueChange=${setRepeatLastN}/>
					</div>`}
				${(endpointAPI == 0 || !openaiPresets ) && html`
					${(endpointAPI != 1 && (!openaiPresets || endpointAPI != 3)) && html`
						<${Checkbox} label="Penalize NL"
							disabled=${!!cancel} value=${penalizeNl} onValueChange=${setPenalizeNl}/>`}
					<div className="hbox">
						<${InputBox} label="Presence penalty" type="number" step="0.01"
							readOnly=${!!cancel} value=${presencePenalty} onValueChange=${setPresencePenalty}/>
						<${InputBox} label="Frequency penalty" type="number" step="1"
							readOnly=${!!cancel} value=${frequencyPenalty} onValueChange=${setFrequencyPenalty}/>
					</div>`}
				${temperature <= 0 ? null : html`
					${(!openaiPresets || endpointAPI != 3 || endpointAPI != 4) && html`
						<${SelectBox}
							label="Mirostat"
							disabled=${!!cancel}
							value=${mirostat}
							onValueChange=${setMirostat}
							options=${[
								{ name: 'Off', value: 0 },
								{ name: 'Mirostat', value: 1 },
								{ name: 'Mirostat 2.0', value: 2 },
							]}/>`}
					${(mirostat && (!openaiPresets || endpointAPI != 3 || endpointAPI != 4)) ? html`
						<div className="hbox">
							<${InputBox} label="Mirostat τ" type="number" step="0.01"
								readOnly=${!!cancel} value=${mirostatTau} onValueChange=${setMirostatTau}/>
							<${InputBox} label="Mirostat η" type="number" step="0.01"
								readOnly=${!!cancel} value=${mirostatEta} onValueChange=${setMirostatEta}/>
						</div>
					` : html`
						<div className="hbox">
							${(!openaiPresets || endpointAPI != 3 || endpointAPI != 4) && html`
								<${InputBox} label="Top K" type="number" step="1"
									readOnly=${!!cancel} value=${topK} onValueChange=${setTopK}/>`}
							<${InputBox} label="Top P" type="number" step="0.01"
								readOnly=${!!cancel} value=${topP} onValueChange=${setTopP}/>
							${(!openaiPresets || endpointAPI != 3) && html`
								<${InputBox} label="Min P" type="number" step="0.01"
									readOnly=${!!cancel} value=${minP} onValueChange=${setMinP}/>`}
						</div>
						${(!openaiPresets || endpointAPI != 3 || endpointAPI != 4) && html`
							<div className="hbox">
								<${InputBox} label="Typical p" type="number" step="0.01"
									readOnly=${!!cancel} value=${typicalP} onValueChange=${setTypicalP}/>
								<${InputBox} label="TFS z" type="number" step="0.01"
									readOnly=${!!cancel} value=${tfsZ} onValueChange=${setTfsZ}/>
							</div>`}
					`}
				`}
				${(!openaiPresets || endpointAPI != 3 || endpointAPI != 4) && html`
					<${Checkbox} label="Ignore <eos>"
						disabled=${!!cancel} value=${ignoreEos} onValueChange=${setIgnoreEos}/>`}
			</${CollapsibleGroup}>
			
			${!!tokens && html`
				<${InputBox} label="Tokens" value=${tokens} readOnly/>`}
			<div className="buttons">
				<button
					title="Run next prediction (Ctrl + Enter)"
					className=${cancel ? (predictStartTokens === tokens ? 'processing' : 'completing') : ''}
					disabled=${!!cancel || stoppingStringsError}
					onClick=${() => predict()}>
					Predict
				</button>
				<button
					title="Cancel prediction (Escape)"
					disabled=${!cancel}
					onClick=${cancel}>
					Cancel
				</button>
				
				<div className="shorts">
					${!cancel && (!!undoStack.current.length || !!redoStack.current.length) && html`
						<button
							title="Undo (Ctrl + Z)"
							disabled=${!undoStack.current.length}
							onClick=${() => undo()}
							onMouseEnter=${() => setUndoHovered(true)}
							onMouseLeave=${() => setUndoHovered(false)}>
							<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><path d="M17.026 22.957c10.957-11.421-2.326-20.865-10.384-13.309l2.464 2.352h-9.106v-8.947l2.232 2.229c14.794-13.203 31.51 7.051 14.794 17.675z" fill="var(--color-light)"/></svg>
						</button>`}
					${!cancel && (!!undoStack.current.length || !!redoStack.current.length) && html`
						<button
							title="Redo (Ctrl + Y)"
							disabled=${!redoStack.current.length}
							onClick=${() => redo()}>
							<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><path d="M6.974 22.957c-10.957-11.421 2.326-20.865 10.384-13.309l-2.464 2.352h9.106v-8.947l-2.232 2.229c-14.794-13.203-31.51 7.051-14.794 17.675z" fill="var(--color-light)"/></svg>
						</button>`}
				</div>
			</div>
			${!!lastError && html`
				<span className="error-text">${lastError}</span>`}
		</div>
		
		<${Modal} isOpen=${modalState.prompt} onClose=${() => closeModal("prompt")}
		title="Editor Preferences"
		description=""
		style=${{ 'width': '30%' }}>
			<div className="vbox">
				<${Checkbox} label="Enable spell checking"
					value=${spellCheck} onValueChange=${setSpellCheck}/>
				<${Checkbox} label="Attach sidebar"
					value=${attachSidebar} onValueChange=${setAttachSidebar}/>
				<${Checkbox} label="Highlight generated tokens"
					value=${highlightGenTokens} onValueChange=${setHighlightGenTokens}/>
				<${Checkbox} label="Preserve cursor position after prediction"
					value=${preserveCursorPosition} onValueChange=${setPreserveCursorPosition}/>
				<${SelectBox}
					label="Token probabilities"
					value=${showProbsMode}
					onValueChange=${setShowProbsMode}
					options=${[
						{ name: 'Show on hover', value: 0 },
						{ name: 'Show on hover while holding CTRL', value: 1 },
						{ name: 'Don\'t show', value: -1 },
					]}/>
			</div>
		</${Modal}>
		<${Modal} isOpen=${modalState.memory} onClose=${() => closeModal("memory")}
		title="Memory"
		description="This text will be added at the very top of your context.
		Prefix and suffix will be attached at the beginning or end of your memory respectively. \\n for newlines in pre/suffix.">
			<div className="hbox">
				<${InputBox} label="Prefix" type="text" placeholder="[INST]"
					readOnly=${!!cancel} value=${memoryTokens.prefix} onValueChange=${(value) => handleMemoryTokensChange("prefix", value)}/>
				<${InputBox} label="Suffix" type="text" placeholder="[/INST]"
					readOnly=${!!cancel} value=${memoryTokens.suffix} onValueChange=${(value) => handleMemoryTokensChange("suffix", value)}/>
			</div>
			<textarea
				readOnly=${!!cancel}
				placeholder="Anything written here will be injected at the head of the prompt. Tokens here DO count towards the Context Limit."
				defaultValue=${memoryTokens.text}
				value=${memoryTokens.text}
				onInput=${(e) => handleMemoryTokensChange("text", e.target.value) }
				class="expanded-text-area-settings"
				id="memory-area-settings"/>
		</${Modal}>
		<${Modal} isOpen=${modalState.an} onClose=${() => closeModal("an")}
		title="Author's Note"
		description="This text will be injected N newlines from the bottom of your prompt.
		Prefix and suffix will be attached at the beginning or end of your author's note respectively. \\n for newlines in pre/suffix.">
			<div className="hbox">
				<${InputBox} label="Prefix" type="text" placeholder="[INST]"
					readOnly=${!!cancel} value=${authorNoteTokens.prefix} onValueChange=${(value) => handleauthorNoteTokensChange("prefix", value)}/>
				<${InputBox} label="Suffix" type="text" placeholder="[/INST]"
					readOnly=${!!cancel} value=${authorNoteTokens.suffix} onValueChange=${(value) => handleauthorNoteTokensChange("suffix", value)}/>
				<${InputBox} label="AN Injection Depth (0-N)" type="number" step="1"
					readOnly=${!!cancel} value=${authorNoteDepth} onValueChange=${handleAuthorNoteDepthChange}/>
			</div>
			<textarea
			readOnly=${!!cancel}
			placeholder="Anything written here will be injected ${authorNoteDepth} newlines from bottom into context."
			defaultValue=${authorNoteTokens.text}
			value=${authorNoteTokens.text}
			onInput=${(e) => handleauthorNoteTokensChange("text", e.target.value) }
			class="expanded-text-area-settings"
			id="expanded-an-settings"/>
		</${Modal}>
		<${Modal} isOpen=${modalState.context} onClose=${() => closeModal("context")}
			title="Context"
			description="This is the prompt being sent to your large language model.">
		<${CollapsibleGroup} label="Advanced Context Ordering">
			<div id="context-order-desc">
				You can use the following placeholders to order the context according to your needs:<br />
				<div id="advancedContextPlaceholders">
					<table border="1" frame="void" rules="all">
						<thead>
						<tr>
							<th></th>
							<th>Prefix</th>
							<th>Text</th>
							<th>Suffix</th>
						</tr>
						</thead>
						<tbody>
						<tr>
							<th>Memory</th>
							<td>{memPrefix}</td>
							<td>{memText}</td>
							<td>{memSuffix}</td>
						</tr>
						<tr>
							<th>World Info</th>
							<td>{wiPrefix}</td>
							<td>{wiText}</td>
							<td>{wiSuffix}</td>
						</tr>
						<tr>
							<th>Prompt</th>
							<td></td>
							<td>{prompt}</td>
							<td></td>
						</tr>
						</tbody>
					</table>
				</div>
				Any text that is not a placeholder will be added into the context as is.
			</div>
			<textarea
				readOnly=${!!cancel}
				placeholder=${defaultPresets.memoryTokens.contextOrder}
				defaultValue=${memoryTokens.contextOrder}
				value=${memoryTokens.contextOrder}
				onInput=${(e) => handleMemoryTokensChange("contextOrder", e.target.value)}
				class="expanded-text-area-settings"
				id="advanced-context-order-settings"/>
		</${CollapsibleGroup}>
			<textarea
			readOnly=${!!cancel}
			value=${modifiedPrompt}
			class="expanded-text-area-settings"
			id="context-area-settings" readOnly/>
		</${Modal}>
		<${Modal} isOpen=${modalState.wi} onClose=${() => closeModal("wi")}
			title="World Info"
			description="Additional information that is added when specific keywords are found in context.
			World info will be added at the top of your memory, in the order specified here.
			Each entry will begin on a newline. Keys will be interpreted as case-insensitive regular expressions. Search Range specifies how many tokens back into the context will be searched for activation keys. Search range 0 to disable an entry.">
			<div id="modal-wi-global">
				<${CollapsibleGroup} label="Prefix/Suffix">
					The prefix and suffix will be added at the beginning or end of all your active World Info entries respectively.
					<br />
					<div className="hbox">
						<${InputBox} label="Prefix" type="text" placeholder="\\n"
							readOnly=${!!cancel} value=${worldInfo.prefix} onValueChange=${(value) => handleWorldInfoAffixChange("prefix", value)}/>
						<${InputBox} label="Suffix" type="text" placeholder="\\n"
							readOnly=${!!cancel} value=${worldInfo.suffix} onValueChange=${(value) => handleWorldInfoAffixChange("suffix", value)}/>
					</div>
				</${CollapsibleGroup}>
				<button id="button-wi-new" disabled=${!!cancel} onClick=${handleWorldInfoNew}>New Entry</button>
			</div>
			<div className="modal-wi-content">
				${ !Array.isArray(worldInfo.entries) ? null : worldInfo.entries.map((entry, index) => html`
				<div class="wi-entry" key=${index}>
					<div class="wi-entry-controls">
						<div class="wi-entry-filler" />
						<div class="wi-entry-name">
							<${InputBox}
							label="Entry #${index+1}"
							type="text"
							readOnly=${!!cancel}
							placeholder="Name of this entry"
							value=${entry.displayName}
							onValueChange=${(value) => handleWorldInfoChange("displayName",index,value)}
							/>
						</div>
						<div class="wi-entry-buttons">
							<div class="wi-entry-buttons-container">
								<button disabled=${!!cancel} onClick=${() => handleWorldInfoMove(index,-1)}>
									<svg fill="var(--color-light)" height="12" width="12" viewBox="0 0 330 330"><path d="M325.606,229.393l-150.004-150C172.79,76.58,168.974,75,164.996,75c-3.979,0-7.794,1.581-10.607,4.394 l-149.996,150c-5.858,5.858-5.858,15.355,0,21.213c5.857,5.857,15.355,5.858,21.213,0l139.39-139.393l139.397,139.393 C307.322,253.536,311.161,255,315,255c3.839,0,7.678-1.464,10.607-4.394C331.464,244.748,331.464,235.251,325.606,229.393z"/></svg>
								</button>
								<button disabled=${!!cancel} onClick=${() => handleWorldInfoDel(index)}>
									✕
								</button>
								<button disabled=${!!cancel} onClick=${() => handleWorldInfoMove(index,1)}>
									<svg fill="var(--color-light)" height="12" width="12" viewBox="0 0 330 330"><path d="M325.607,79.393c-5.857-5.857-15.355-5.858-21.213,0.001l-139.39,139.393L25.607,79.393 c-5.857-5.857-15.355-5.858-21.213,0.001c-5.858,5.858-5.858,15.355,0,21.213l150.004,150c2.813,2.813,6.628,4.393,10.606,4.393 s7.794-1.581,10.606-4.394l149.996-150C331.465,94.749,331.465,85.251,325.607,79.393z"/></svg>
								</button>
							</div>
						</div>
						<div class="wi-entry-text">
							<div class="hbox">
								<${InputBox}
									label="Comma Separated RegEx Keys"
									type="text"
									readOnly=${!!cancel}
									value=${entry.keys.join(',')}
									placeholder="Required to activate entry"
									onValueChange=${(value) => handleWorldInfoChange("keys",index,value)}
									/>
								<${InputBox}
									label="Search Range (0 = disabled)"
									tooltip="Currently not accurate to the token count, it will be used as an estimate."
									type="text"
									readOnly=${!!cancel}
									inputmode="numeric"
									value=${entry.search}
									placeholder="2048"
									onValueChange=${(value) => handleWorldInfoChange("search",index,value)}
									/>
							</div>
							<label class="TextArea">
								Text
								<textarea
									readOnly=${!!cancel}
									placeholder="Information to be inserted into context when key is found"
									value=${entry.text ? entry.text : ""}
									defaultValue=${entry.text ? entry.text : ""}
									onInput=${(e) => handleWorldInfoChange("text",index, e.target.value)}
									class="wi-textarea" />
							</label>
							</div>
						</div>
					</div>
				`)}
			</div>
		</${Modal}>
	`;
}

async function main() {
	const sessionStorage = new SessionStorage(defaultPresets);
	await sessionStorage.init();

	createRoot(document.body).render(html`
		<${App}
			sessionStorage=${sessionStorage}
			useSessionState=${(name, initialState) => useSessionState(sessionStorage, name, initialState)}/>`);
}

main();