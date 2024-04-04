<h1 align="center">Scrollview Resize</h1>

<p align="center">Report changes to the dimensions of an Element's scrollWidth and scrollHeight</p>

- [Why does this project exist?](#why-does-this-project-exist)
- [Installation](#installation)
- [Polyfill](#polyfill)
- [Examples](#examples)
- [License](#license)

## Why does this project exist?

**Scrollview Resize** provide the solution that we can report changes to the dimensions of an Element's scrollWidth and scrollHeight.

## Installation

```bash
npm install scrollview-resize

// or yarn
yarn add scrollview-resize
```

## Polyfill

`ResizeObserver` is used in the code, IE dont support it, so you need [polyfill](https://www.npmjs.com/package/resize-observer-polyfill) for that.

## Examples

```ts
import { SVResizeObserver } from 'scrollview-resize';

const el = document.querySelector('selector');

const observer = new SVResizeObserver(() => {
  console.log('Scroll size changed');
});

observer.observe(el);
```

## License

[MIT](LICENSE.md)
