import { ContentDownloadRequest, DownloadRequest } from 'sunbird-sdk';
import { OnInit } from '@angular/core';
import { Observable } from 'rxjs/Observable';

export interface ActiveDownloadsInterface extends OnInit {
  activeDownloadRequests$: Observable<ContentDownloadRequest[]>;

  cancelAllDownloads(): void;
  cancelDownload(downloadRequest: DownloadRequest): void;

  getContentDownloadProgress(contentId: string): number;
}
