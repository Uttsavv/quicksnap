// Mixes mic + system/tab audio into a single track (MediaRecorder only records
// one audio track) and exposes per-channel levels for the meters.

export interface Channel {
    id: string;
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
    analyser: AnalyserNode;
    buf: Float32Array<ArrayBuffer>;
    gainValue: number;
    muted: boolean;
}

export class Mixer {
    readonly ctx: AudioContext;
    readonly dest: MediaStreamAudioDestinationNode;
    private channels = new Map<string, Channel>();

    constructor() {
        this.ctx = new AudioContext({ sampleRate: 48000 });
        this.dest = this.ctx.createMediaStreamDestination();
        this.dest.channelCount = 2;
    }

    get track(): MediaStreamTrack {
        return this.dest.stream.getAudioTracks()[0];
    }

    has(id: string) {
        return this.channels.has(id);
    }

    set(id: string, stream: MediaStream | null) {
        this.remove(id);
        if (!stream || stream.getAudioTracks().length === 0) return;
        const audioOnly = new MediaStream(stream.getAudioTracks());
        const source = this.ctx.createMediaStreamSource(audioOnly);
        const gain = this.ctx.createGain();
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(gain);
        gain.connect(analyser);
        gain.connect(this.dest);
        this.channels.set(id, { id, source, gain, analyser, buf: new Float32Array(analyser.fftSize), gainValue: 1, muted: false });
        void this.ctx.resume();
    }

    remove(id: string) {
        const c = this.channels.get(id);
        if (!c) return;
        c.source.disconnect();
        c.gain.disconnect();
        this.channels.delete(id);
    }

    setGain(id: string, v: number) {
        const c = this.channels.get(id);
        if (!c) return;
        c.gainValue = v;
        c.gain.gain.setTargetAtTime(c.muted ? 0 : v, this.ctx.currentTime, 0.02);
    }

    setMuted(id: string, muted: boolean) {
        const c = this.channels.get(id);
        if (!c) return;
        c.muted = muted;
        c.gain.gain.setTargetAtTime(muted ? 0 : c.gainValue, this.ctx.currentTime, 0.02);
    }

    /** Peak level in dBFS (−∞..0) after gain. */
    level(id: string): number {
        const c = this.channels.get(id);
        if (!c) return -Infinity;
        c.analyser.getFloatTimeDomainData(c.buf);
        let peak = 0;
        for (const v of c.buf) peak = Math.max(peak, Math.abs(v));
        return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    }

    close() {
        for (const id of [...this.channels.keys()]) this.remove(id);
        void this.ctx.close();
    }
}
