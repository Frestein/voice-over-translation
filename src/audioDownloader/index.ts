import { AudioDownloadType } from "@vot.js/core/types/yandex";

import { EventImpl } from "../core/eventImpl";
import {
  AudioDownloadRequestOptions,
  DownloadedAudioData,
  DownloadedPartialAudioData,
  VideoIdPayload,
} from "../types/audioDownloader";
import { MessagePayload } from "../types/iframeConnector";
import debug from "../utils/debug";

import { AvailableAudioDownloadType, strategies } from "./strategies";
import { sendRequestToIframe } from "./strategies/utils";

async function handleCommonAudioDownloadRequest({
  audioDownloader,
  translationId,
  videoId,
  signal,
}: AudioDownloadRequestOptions) {
  const audioData = await strategies[audioDownloader.strategy]({
    videoId,
    returnByParts: true,
    signal,
  });
  if (!audioData) {
    throw new Error("Audio downloader. Can not get audio data");
  }
  debug.log("Audio downloader. Url found", {
    audioDownloadType: audioDownloader.strategy,
  });

  const { getMediaBuffers, mediaPartsLength, fileId } = audioData;
  if (mediaPartsLength < 2) {
    const { value }: { value: Uint8Array } = await getMediaBuffers().next();
    if (!value) {
      throw new Error("Audio downloader. Empty audio");
    }

    audioDownloader.onDownloadedAudio.dispatch(translationId, {
      videoId,
      fileId,
      audioData: value,
    });
    return;
  }

  let index = 0;
  for await (const audioChunk of getMediaBuffers()) {
    if (!audioChunk) {
      throw new Error("Audio downloader. Empty audio");
    }

    audioDownloader.onDownloadedPartialAudio.dispatch(translationId, {
      videoId,
      fileId,
      audioData: audioChunk,
      version: 1,
      index,
      amount: mediaPartsLength,
    });

    index++;
  }
}

export async function mainWorldMessageHandler({
  data,
}: MessageEvent<MessagePayload>) {
  try {
    if (data?.messageDirection !== "request") {
      return;
    }

    switch (data.messageType) {
      case "get-download-audio-data-in-main-world": {
        await sendRequestToIframe(
          "get-download-audio-data-in-iframe",
          data as MessagePayload<VideoIdPayload>,
        );
        break;
      }
    }
  } catch (error) {
    console.error("[VOT] Main world bridge", {
      error,
    });
  }
}

export class AudioDownloader {
  onDownloadedAudio = new EventImpl();
  onDownloadedPartialAudio = new EventImpl();
  onDownloadAudioError = new EventImpl();

  strategy: AvailableAudioDownloadType;

  constructor(
    strategy: AvailableAudioDownloadType = AudioDownloadType.WEB_API_GET_ALL_GENERATING_URLS_DATA_FROM_IFRAME,
  ) {
    this.strategy = strategy;
    debug.log("Audio downloader created", {
      strategy,
    });
  }

  async runAudioDownload(
    videoId: string,
    translationId: string,
    signal: AbortSignal,
  ) {
    window.addEventListener("message", mainWorldMessageHandler);
    try {
      await handleCommonAudioDownloadRequest({
        audioDownloader: this,
        translationId,
        videoId,
        signal,
      });
      debug.log("Audio downloader. Audio download finished", {
        videoId,
      });
    } catch (err) {
      console.error("Audio downloader. Failed to download audio", err);
      this.onDownloadAudioError.dispatch(videoId);
    }

    window.removeEventListener("message", mainWorldMessageHandler);
  }

  addEventListener(
    type: "downloadedAudio",
    listener: (translationId: string, data: DownloadedAudioData) => void,
  ): this;
  addEventListener(
    type: "downloadedPartialAudio",
    listener: (translationId: string, data: DownloadedPartialAudioData) => void,
  ): this;
  addEventListener(
    type: "downloadAudioError",
    listener: (videoId: string) => void,
  ): this;
  addEventListener(
    type: "downloadedAudio" | "downloadedPartialAudio" | "downloadAudioError",
    listener: (...data: any[]) => void,
  ): this {
    switch (type) {
      case "downloadedAudio":
        this.onDownloadedAudio.addListener(listener);
        break;
      case "downloadedPartialAudio":
        this.onDownloadedPartialAudio.addListener(listener);
        break;
      case "downloadAudioError":
        this.onDownloadAudioError.addListener(listener);
        break;
    }

    return this;
  }

  removeEventListener(
    type: "downloadedAudio",
    listener: (translationId: string, data: DownloadedAudioData) => void,
  ): this;
  removeEventListener(
    type: "downloadedPartialAudio",
    listener: (translationId: string, data: DownloadedPartialAudioData) => void,
  ): this;
  removeEventListener(
    type: "downloadAudioError",
    listener: (videoId: string) => void,
  ): this;
  removeEventListener(
    type: "downloadedAudio" | "downloadedPartialAudio" | "downloadAudioError",
    listener: (...data: any[]) => void,
  ): this {
    switch (type) {
      case "downloadedAudio":
        this.onDownloadedAudio.removeListener(listener);
        break;
      case "downloadedPartialAudio":
        this.onDownloadedPartialAudio.removeListener(listener);
        break;
      case "downloadAudioError":
        this.onDownloadAudioError.removeListener(listener);
        break;
    }

    return this;
  }
}
