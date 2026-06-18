import { render } from 'solid-js/web';
import { App } from './App';

const style = document.createElement('style');
style.textContent = `
  #illiterati-overlay {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483647;
    background: #111;
    color: #fff;
    border-radius: 10px;
    padding: 10px;
    font: 12px/1.4 ui-sans-serif, system-ui, sans-serif;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }
  #illiterati-play {
    border: 0;
    border-radius: 6px;
    padding: 6px 10px;
    cursor: pointer;
    margin-bottom: 6px;
  }
  #illiterati-status {
    max-width: 240px;
    word-break: break-word;
  }
`;

document.documentElement.append(style);

const root = document.createElement('div');
root.id = 'illiterati-root';
document.documentElement.append(root);

render(() => <App />, root);
