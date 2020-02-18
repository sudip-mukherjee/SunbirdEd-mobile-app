import { ChangeDetectorRef, Component, EventEmitter, Inject, Input, OnInit, Output, OnDestroy, NgZone } from '@angular/core';
import { Events, MenuController, Platform } from '@ionic/angular';
import {
  AppGlobalService, UtilityService, CommonUtilService, NotificationService, TelemetryGeneratorService,
  InteractType, InteractSubtype, Environment, PageId, ActivePageService
} from '../../../services';
import { DownloadService, SharedPreferences, NotificationService as PushNotificationService, NotificationStatus, EventNamespace, DownloadProgress, DownloadEventType, EventsBusService } from 'sunbird-sdk';
import { GenericAppConfig, PreferenceKey, EventTopics } from '../../../app/app.constant';
import { AppVersion } from '@ionic-native/app-version/ngx';
import { Subscription } from 'rxjs/Subscription';
import { TranslateService } from '@ngx-translate/core';
import { NavigationExtras, Router, RouterLink } from '@angular/router';
import { combineLatest } from 'rxjs';
import { SpeechRecognition } from '@ionic-native/speech-recognition/ngx';

@Component({
  selector: 'app-application-header',
  templateUrl: './application-header.component.html',
  styleUrls: ['./application-header.component.scss'],
})
export class ApplicationHeaderComponent implements OnInit, OnDestroy {
  downloadProgressMap: { [key: string]: number } = {};
  selectedLanguage: string;
  @Input() headerConfig: any = false;
  @Output() headerEvents = new EventEmitter();
  @Output() sideMenuItemEvent = new EventEmitter();

  appLogo?: string;
  appName?: string;
  versionName?: string;
  versionCode?: string;
  decreaseZindex = false;
  isRtl: boolean;
  isLoggedIn = false;
  isDownloadingActive: boolean = false;
  showDownloadingIcon: boolean = false;
  networkSubscription: Subscription;
  isUnreadNotification: boolean = false;
  menuSide = 'left';
  isPermissionAvailable = true;
  storedResult = [];
  eventName: string;
  volumeKeypressCount: number;
  constructor(
    @Inject('SHARED_PREFERENCES') private preference: SharedPreferences,
    @Inject('DOWNLOAD_SERVICE') private downloadService: DownloadService,
    @Inject('NOTIFICATION_SERVICE') private pushNotificationService: PushNotificationService,
    @Inject('EVENTS_BUS_SERVICE') private eventsBusService: EventsBusService,
    public menuCtrl: MenuController,
    private commonUtilService: CommonUtilService,
    private events: Events,
    private appGlobalService: AppGlobalService,
    private appVersion: AppVersion,
    private utilityService: UtilityService,
    private changeDetectionRef: ChangeDetectorRef,
    private notification: NotificationService,
    private translate: TranslateService,
    private platform: Platform,
    private router: Router,
    private ngZone: NgZone,
    private telemetryGeneratorService: TelemetryGeneratorService,
    private activePageService: ActivePageService,
    private speechRecognition: SpeechRecognition
  ) {
    this.setLanguageValue();
    this.events.subscribe('onAfterLanguageChange:update', (res) => {
      if (res && res.selectedLanguage) {
        this.setLanguageValue();
      }
    });
    this.getUnreadNotifications();
  }

  ngOnInit() {
    window.addEventListener('volumebuttonslistener', this.onVolumeButtonsListener.bind(this), false);
    this.eventName = this.activePageService.computePageId(this.router.url);
    console.log('this.eventName', this.eventName);
    this.setAppLogo();
    this.setAppVersion();
    this.events.subscribe('user-profile-changed', () => {
      this.setAppLogo();
    });
    this.events.subscribe('app-global:profile-obj-changed', () => {
      this.setAppLogo();
    });

    this.events.subscribe('notification-status:update', (eventData) => {
      this.isUnreadNotification = eventData.isUnreadNotifications;
    });
    this.translate.onLangChange.subscribe((params) => {
      this.ngZone.run(() => {
        if (params.lang === 'ur' && !this.platform.isRTL) {
          this.isRtl = true;
          this.menuSide = 'right';
        } else if (this.platform.isRTL) {
          this.menuSide = 'left';
          this.isRtl = false;
        }
      });
    });
    this.events.subscribe('header:decreasezIndex', () => {
      this.decreaseZindex = true;
    });
    this.events.subscribe('header:setzIndexToNormal', () => {
      this.decreaseZindex = false;
    });
    this.listenDownloads();
    this.networkSubscription = this.commonUtilService.networkAvailability$.subscribe((available: boolean) => {
      this.setAppLogo();
    });
  }

  onVolumeButtonsListener() {
    if (isNaN(this.volumeKeypressCount)) {
      this.volumeKeypressCount = 0;
    }
    this.volumeKeypressCount = this.volumeKeypressCount + 1;
    if (this.volumeKeypressCount === 2) {
      this.startRecording();
    }
    setTimeout(() => {
      console.log('resetting');
      this.volumeKeypressCount = 0;
    }, 1500);
  }

  setAppVersion(): any {
    this.utilityService.getBuildConfigValue(GenericAppConfig.VERSION_NAME)
      .then(vName => {
        this.versionName = vName;
        this.utilityService.getBuildConfigValue(GenericAppConfig.VERSION_CODE)
          .then(vCode => {
            this.versionCode = vCode;
          })
          .catch(error => {
            console.error('Error in getting app version code', error);
          });
      })
      .catch(error => {
        console.error('Error in getting app version name', error);
      });
  }

  setLanguageValue() {
    this.preference.getString(PreferenceKey.SELECTED_LANGUAGE).toPromise()
      .then(value => {
        this.selectedLanguage = value;
      });
    this.preference.getString(PreferenceKey.SELECTED_LANGUAGE_CODE).toPromise()
      .then(langCode => {
        console.log('Language code: ', langCode);
        this.notification.setupLocalNotification(langCode);
      });
  }

  listenDownloads() {
    combineLatest([
      this.downloadService.getActiveDownloadRequests(),
      this.eventsBusService.events(EventNamespace.DOWNLOADS)
        .filter((event) => event.type === DownloadEventType.PROGRESS)
    ]).subscribe(([list, event]) => {
      const downloadEvent = event as DownloadProgress;
      this.downloadProgressMap[downloadEvent.payload.identifier] = downloadEvent.payload.progress;

      if (list.length > 1) {
        this.showDownloadingIcon = true;
      } else if (list.length === 1 && this.downloadProgressMap[list[0].identifier] !== 100) {
        this.showDownloadingIcon = true;
      } else {
        this.showDownloadingIcon = false;
      }

      this.changeDetectionRef.detectChanges();
    });
  }

  setAppLogo() {
    if (!this.appGlobalService.isUserLoggedIn()) {
      this.isLoggedIn = false;
      this.appLogo = './assets/imgs/ic_launcher.png';
      this.appVersion.getAppName().then((appName: any) => {
        this.appName = appName;
      });
    } else {
      this.isLoggedIn = true;
      this.preference.getString('app_logo').toPromise().then(value => {
        if (value) {
          this.appLogo = this.commonUtilService.networkInfo.isNetworkAvailable ? value : './assets/imgs/ic_launcher.png';
        } else {
          this.appLogo = './assets/imgs/ic_launcher.png';
        }
      });
      this.preference.getString('app_name').toPromise().then(value => {
        this.appName = value;
      });
    }
  }

  toggleMenu() {
    this.menuCtrl.toggle();
    if (this.menuCtrl.isOpen()) {
      const pageId = this.activePageService.computePageId(this.router.url);
      this.telemetryGeneratorService.generateInteractTelemetry(
        InteractType.TOUCH,
        InteractSubtype.MENU_CLICKED,
        Environment.HOME,
        pageId, undefined
      );
    }
    this.events.publish(EventTopics.HAMBURGER_MENU_CLICKED);
  }

  emitEvent($event, name) {

    if(name === 'filter') {
      if(this.commonUtilService.networkInfo.isNetworkAvailable) {
        this.headerEvents.emit({ name, event: $event });
      }
      else{
        this.commonUtilService.showToast('NEED_INTERNET_TO_CHANGE');
      }
    }
    else {
      this.headerEvents.emit({ name, event: $event });
    }
  }

  emitSideMenuItemEvent($event, menuItem) {
    this.toggleMenu();
    this.sideMenuItemEvent.emit({ menuItem });
  }

  ngOnDestroy() {
    if (this.networkSubscription) {
      this.networkSubscription.unsubscribe();
    }
    this.events.subscribe('user-profile-changed');
    this.events.subscribe('app-global:profile-obj-changed');
  }

  getUnreadNotifications() {
    let newNotificationCount = 0;
    this.pushNotificationService.getAllNotifications({ notificationStatus: NotificationStatus.ALL }).subscribe((notificationList: any) => {
      notificationList.forEach((item) => {
        if (!item.isRead) {
          newNotificationCount++;
        }
      });

      this.isUnreadNotification = Boolean(newNotificationCount);
    });
  }

  startRecording() {

    // library `courses`
    this.eventName = this.activePageService.computePageId(this.router.url);
    console.log(' this.activePageService.computePageId(this.router.url)',
    this.activePageService.computePageId(this.router.url));
    console.log('this.eventName', this.eventName );
    // this.checkPermission();
    if (this.eventName === 'library' || this.eventName === 'courses') {
    (window as any).TTS.speak(`Say something to search in ${this.eventName} page`);
    } else if (this.eventName === 'search') {
      (window as any).TTS.speak(`say which content you want to play`);
    }
    if (this.isPermissionAvailable) {
      this.speechRecognition.startListening().subscribe(matches => {
        this.storedResult = matches;
        this.changeDetectionRef.detectChanges();
        console.log('subscription started');
        this.headerEvents.emit({ name: 'voiceSearch-' + this.eventName, event: this.storedResult });
      }, (error) => {
        console.log('error detected', error);
      });
    }
  }

  checkPermission() {
    this.speechRecognition.hasPermission()
      .then((hasPermission: boolean) => {
        if (!hasPermission) {
          this.isPermissionAvailable = false;
          this.speechRecognition.requestPermission();
        } else {
          this.isPermissionAvailable = true;
        }
      });
  }
}
