interface Window {
  YT?: any;
  onYouTubeIframeAPIReady?: () => void;
  webkitAudioContext?: typeof AudioContext;
  documentPictureInPicture?: {
    requestWindow(options: { width: number; height: number }): Promise<Window>;
  };
  _toastTimer?: number;
  _downloadPollTimer?: number;
}

declare const YT: any;
