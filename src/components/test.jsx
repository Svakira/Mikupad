// MiComponente.js
import React from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { html } from 'htm/react';
import { SVResizeObserver } from 'scrollview-resize';

const MiComponente = () => {
    return (
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
    );
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


};



export default MiComponente;
