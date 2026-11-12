import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./lib/ffmpeg-client', () => ({
  BrowserVideoEngine: class {
    isLoaded = false;
    load = vi.fn(async () => { this.isLoaded = true; });
    convert = vi.fn(async () => new Uint8Array([1, 2, 3]));
    terminate = vi.fn();
  },
}));

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

describe('LocalCut app', () => {
  it('shows the local upload experience and privacy promise', () => {
    render(<App />);
    expect(screen.getByText('Drop your video here')).toBeInTheDocument();
    expect(screen.getByText(/never uploaded/i)).toBeInTheDocument();
  });

  it('accepts a video file and exposes conversion modes', () => {
    render(<App />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['video-data'], 'clip.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /compress/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /convert/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /audio/i })).toBeInTheDocument();
  });

  it('runs the conversion flow and exposes a download when the engine returns output', async () => {
    render(<App />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['video-data'], 'clip.mp4', { type: 'video/mp4' })] } });
    fireEvent.click(screen.getByRole('button', { name: /compress video/i }));
    await waitFor(() => expect(screen.getByText('Your file is ready')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute('download', 'clip.mp4');
  });

  it('switches to audio extraction settings', () => {
    render(<App />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['video-data'], 'clip.mp4', { type: 'video/mp4' })] } });
    fireEvent.click(screen.getByRole('tab', { name: /audio/i }));
    expect(screen.getByLabelText('Audio format')).toBeInTheDocument();
    expect(screen.getByText(/saves only the audio track/i)).toBeInTheDocument();
  });
});
