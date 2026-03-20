/**
 * Angular standalone chat component using SlotmuxService.
 *
 * Copy this into your Angular project's `src/app/` directory alongside
 * slotmux.service.ts. Use in your app component or route.
 */

import { Component, signal, viewChild, type ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SlotmuxService } from './slotmux.service';

type Message = { role: 'user' | 'assistant'; content: string };

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="container">
      <h1>Slotmux Angular Chat</h1>

      @if (slotmux.meta()) {
        <div class="status">
          <span>Tokens: {{ slotmux.totalTokens() }}</span>
          <span>Utilization: {{ (slotmux.utilization() * 100).toFixed(1) }}%</span>
          <span>Build: {{ slotmux.meta()!.buildTimeMs }}ms</span>
        </div>
      }

      @if (slotmux.buildError()) {
        <div class="error">Build error: {{ slotmux.buildError() }}</div>
      }

      <div class="messages">
        @for (m of messages(); track $index) {
          <div [class]="'message ' + m.role">
            <span class="bubble">{{ m.content }}</span>
          </div>
        }
        <div #chatEnd></div>
      </div>

      <form (ngSubmit)="send()" class="input-row">
        <input
          [(ngModel)]="input"
          name="input"
          placeholder="Type a message..."
        />
        <button type="submit">Send</button>
      </form>
    </div>
  `,
  styles: [`
    .container {
      max-width: 640px;
      margin: 0 auto;
      padding: 2rem;
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .status {
      display: flex;
      gap: 1rem;
      padding: 0.5rem 1rem;
      background: #f5f5f5;
      border-radius: 8px;
      font-size: 0.85rem;
      color: #666;
    }
    .error {
      color: red;
      padding: 0.5rem;
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 1rem;
      margin: 1rem 0;
    }
    .message { margin-bottom: 0.75rem; }
    .message.user { text-align: right; }
    .bubble {
      display: inline-block;
      padding: 0.5rem 0.75rem;
      border-radius: 12px;
      max-width: 80%;
    }
    .message.user .bubble { background: #dd0031; color: #fff; }
    .message.assistant .bubble { background: #f0f0f0; color: #000; }
    .input-row { display: flex; gap: 8px; }
    .input-row input {
      flex: 1;
      padding: 0.75rem;
      border-radius: 8px;
      border: 1px solid #ddd;
      font-size: 1rem;
    }
    .input-row button {
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      border: none;
      background: #dd0031;
      color: #fff;
      font-size: 1rem;
      cursor: pointer;
    }
  `],
})
export class ChatComponent {
  messages = signal<Message[]>([]);
  input = '';
  chatEnd = viewChild<ElementRef>('chatEnd');

  constructor(public slotmux: SlotmuxService) {}

  async send() {
    const text = this.input.trim();
    if (!text) return;

    this.messages.update((prev) => [...prev, { role: 'user', content: text }]);
    this.input = '';

    this.slotmux.user(text);
    await this.slotmux.build();

    // Simulate assistant response (replace with real API call)
    const reply = `Echo: ${text}`;
    this.slotmux.assistant(reply);
    await this.slotmux.build();

    this.messages.update((prev) => [
      ...prev,
      { role: 'assistant', content: reply },
    ]);

    setTimeout(() => {
      this.chatEnd()?.nativeElement.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }
}
