const recordingButton = document.querySelector("[recording-button]")!;

const audioCheckbox = document.getElementById("audio") as HTMLInputElement;
const facecamCheckbox = document.getElementById("facecam") as HTMLInputElement;
const screenCheckbox = document.getElementById("screen") as HTMLInputElement;
const outputCanvas = document.querySelector(
    "[output-canvas]"
) as HTMLCanvasElement;
const canvasCtx = outputCanvas.getContext("2d");

let animationFrameId: number | null = null;

let facecamMediaStream: MediaStream | null = null;
let screenMediaStream: MediaStream | null = null;

// Create hidden video elements for rendering
const facecamVideo = document.createElement("video");
const screenVideo = document.createElement("video");
facecamVideo.autoplay = true;
// facecamVideo.muted = true;
screenVideo.autoplay = true;

function getLiveRecordingConfig() {
    return {
        audio: audioCheckbox.checked,
        screen: screenCheckbox.checked,
        facecam: facecamCheckbox.checked,
    };
}

function getMediaConstraints(
    stream: "screen" | "facecam"
): MediaStreamConstraints {
    const currentConfig = getLiveRecordingConfig();
    let constraints = {
        audio: currentConfig.audio,
        video: {},
    };

    if (stream === "screen" && currentConfig.screen) {
        constraints.video = { width: 720, height: 480 };
    } else if (stream === "facecam" && currentConfig.facecam) {
        constraints.video = { width: 720 / 4, height: 480 / 4 };
    }

    return constraints;
}

// Toggle recording on button click
recordingButton?.addEventListener("click", () => {
    if (!facecamMediaStream && !screenMediaStream) {
        startRecording();
    } else {
        stopRecording();
    }
});

// Start the recording (get media)
async function startRecording() {
    recordingButton.textContent = "Stop Recording";
    outputCanvas.classList.remove("hidden");

    const currentConfig = getLiveRecordingConfig();

    try {
        if (currentConfig.facecam) {
            await getFacecamStream();
            facecamMediaStream && playStream(facecamMediaStream, facecamVideo);
        }

        if (currentConfig.screen) {
            await getScreenStream();
            screenMediaStream && playStream(screenMediaStream, screenVideo);
        }

        startCanvasRendering();
    } catch (err) {
        console.error("Error accessing media devices:", err);
    }
}

async function getFacecamStream() {
    try {
        facecamMediaStream = await navigator.mediaDevices.getUserMedia(
            getMediaConstraints("facecam")
        );
    } catch (err) {
        console.error(err);
    }
}

async function getScreenStream() {
    try {
        screenMediaStream = await navigator.mediaDevices.getDisplayMedia(
            getMediaConstraints("screen")
        );
    } catch (err) {
        console.error(err);
    }
}

// Stop the recording
function stopRecording() {
    if (facecamMediaStream) {
        stopStreamTracks(facecamMediaStream);
        facecamMediaStream = null;
    }

    if (screenMediaStream) {
        stopStreamTracks(screenMediaStream);
        screenMediaStream = null;
    }

    resetUI();

    // Stop rendering to the canvas
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

// Play the media stream in the a player
function playStream(stream: MediaStream, player: HTMLVideoElement) {
    if (player) {
        player.srcObject = stream;
    }
}

// Stop all tracks in the stream
function stopStreamTracks(stream: MediaStream) {
    stream.getTracks().forEach((track) => track.stop());
}

// Reset UI elements
function resetUI() {
    if (recordingButton) {
        recordingButton.textContent = "Start Recording";
    }

    if (canvasCtx) {
        canvasCtx.reset();
        outputCanvas.classList.add("hidden");
    }
}

// Render videos to the canvas
function startCanvasRendering() {
    function render() {
        if (!canvasCtx) {
            return;
        }

        canvasCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);

        // Draw screen video if available
        if (screenMediaStream && screenVideo.readyState >= 2) {
            canvasCtx.drawImage(
                screenVideo,
                0,
                0,
                outputCanvas.width,
                outputCanvas.height
            );
        }

        // Draw facecam video if available
        if (facecamMediaStream && facecamVideo.readyState >= 2) {
            const facecamWidth = outputCanvas.width / 4;
            const facecamHeight = outputCanvas.height / 4;
            canvasCtx.drawImage(
                facecamVideo,
                outputCanvas.width - facecamWidth - 10,
                outputCanvas.height - facecamHeight - 10,
                facecamWidth,
                facecamHeight
            );
        }

        animationFrameId = requestAnimationFrame(render);
    }

    render();
}
