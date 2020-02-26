import { ActivatedRoute, Router } from '@angular/router';
import { CanvasPlayerService } from '@app/services/canvas-player.service';
import { AppGlobalService } from '@app/services/app-global-service.service';
import { CommonUtilService } from '@app/services/common-util.service';
import { Component, OnInit, ViewChild, ElementRef, Inject, OnDestroy } from '@angular/core';
import { Platform, AlertController, Events } from '@ionic/angular';
import { ScreenOrientation } from '@ionic-native/screen-orientation/ngx';
import { PlayerActionHandlerDelegate, HierarchyInfo, User } from './player-action-handler-delegate';
import { StatusBar } from '@ionic-native/status-bar/ngx';
import { EventTopics, RouterLinks, VoiceSearchConstants } from '../app.constant';
import { Location } from '@angular/common';
import { Subscription } from 'rxjs/Subscription';
import { CourseService, Course } from 'sunbird-sdk';
import { AppHeaderService } from '@app/services/app-header.service';

@Component({
  selector: 'app-player',
  templateUrl: './player.page.html'
})
export class PlayerPage implements OnInit, OnDestroy, PlayerActionHandlerDelegate {

  config = {};
  backButtonSubscription: Subscription;
  course: Course;
  pauseSubscription: any;
  headerObservable: any;
  alert: any;

  @ViewChild('preview') previewElement: ElementRef;
  constructor(
    @Inject('COURSE_SERVICE') private courseService: CourseService,
    private canvasPlayerService: CanvasPlayerService,
    private platform: Platform,
    private screenOrientation: ScreenOrientation,
    private appGlobalService: AppGlobalService,
    private statusBar: StatusBar,
    private events: Events,
    private alertCtrl: AlertController,
    private commonUtilService: CommonUtilService,
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private headerService: AppHeaderService
  ) {
    this.canvasPlayerService.handleAction();

    // Binding following methods to making it available to content player which is an iframe
    (window as any).onContentNotFound = this.onContentNotFound.bind(this);
    (window as any).onUserSwitch = this.onUserSwitch.bind(this);

    if (this.router.getCurrentNavigation().extras.state) {
      this.config = this.router.getCurrentNavigation().extras.state.config;
      this.course = this.router.getCurrentNavigation().extras.state.course;
    }
  }

  ngOnInit() {
    this.pauseSubscription = this.platform.pause.subscribe(() => {
      var iframes = window.document.getElementsByTagName('iframe');
      if (iframes.length > 0) {
        iframes[0].contentWindow.postMessage('pause.youtube', '*');
      }
    });
  }
  ionViewWillEnter() {
    this.headerObservable = this.headerService.headerEventEmitted$.subscribe(eventName => {
      this.handleHeaderEvents(eventName);
    });
    this.screenOrientation.lock(this.screenOrientation.ORIENTATIONS.LANDSCAPE);
    this.statusBar.hide();

    this.backButtonSubscription = this.platform.backButton.subscribeWithPriority(10, async () => {
      const activeAlert = await this.alertCtrl.getTop();
      if (!activeAlert) {
        this.showConfirm();
      }
    });
    this.config['uid'] = this.config['context'].actor.id;
    this.config['metadata'].basePath = '/_app_file_' + this.config['metadata'].basePath;

    if (this.config['metadata'].isAvailableLocally) {
      this.config['metadata'].contentData.streamingUrl = '/_app_file_' + this.config['metadata'].contentData.streamingUrl;
    }

    // This is to reload a iframe as iframes reload method not working on cross-origin.
    const src = this.previewElement.nativeElement.src;
    this.previewElement.nativeElement.src = '';
    this.previewElement.nativeElement.src = src;
    this.previewElement.nativeElement.onload = () => {
      console.log('config', this.config);
      setTimeout(() => {
        this.previewElement.nativeElement.contentWindow['cordova'] = window['cordova'];
        this.previewElement.nativeElement.contentWindow['Media'] = window['Media'];
        this.previewElement.nativeElement.contentWindow['initializePreview'](this.config);
        this.previewElement.nativeElement.contentWindow.addEventListener('message', resp => {
          console.log('Player Response', resp);
          if (resp.data === 'renderer:question:submitscore') {
            this.courseService.syncAssessmentEvents();
          }
        });
      }, 1000);
    };

    this.events.subscribe('endGenieCanvas', (res) => {
      if (res.showConfirmBox) {
        this.showConfirm();
      } else {
        this.closeIframe();
      }
    });
  }

  handleHeaderEvents($event) {
    switch ($event.name) {
      case 'voiceSearch-player':
        this.toggleExitPopup($event.event);
        break;
      default:
        break;
    }
  }
  toggleExitPopup(event) {
/** if said exit */
    // tslint:disable-next-line:prefer-for-of
    for (let i = 0; i < event.length; i++) {
      // tslint:disable-next-line:prefer-for-of
      for (let j = 0; j < VoiceSearchConstants.searchConstants.navigationBackConstants.length; j++) {
        if (event[i].includes(VoiceSearchConstants.searchConstants.navigationBackConstants[j])) {
          this.showConfirm();
          return;
        }
      }
    }
    /** if said ok  */
    // tslint:disable-next-line:prefer-for-of
    for (let i = 0; i < event.length; i++) {
      // tslint:disable-next-line:prefer-for-of
      for (let j = 0; j < VoiceSearchConstants.searchConstants.confirmClose.length; j++) {
        if (event[i].includes(VoiceSearchConstants.searchConstants.confirmClose[j])) {
          this.alert.dismiss();
          this.location.back();
          return;
        }
      }
    }

    /** if said cancel */
    // tslint:disable-next-line:prefer-for-of
    for (let i = 0; i < event.length; i++) {
      // tslint:disable-next-line:prefer-for-of
      for (let j = 0; j < VoiceSearchConstants.searchConstants.dismissPopup.length; j++) {
        if (event[i].includes(VoiceSearchConstants.searchConstants.dismissPopup[j])) {
          this.alert.dismiss();
          return;
        }
      }
    }
  }

  ionViewWillLeave() {
    this.statusBar.show();
    this.screenOrientation.unlock();
    this.screenOrientation.lock(this.screenOrientation.ORIENTATIONS.PORTRAIT);

    if (this.events) {
      this.events.unsubscribe('endGenieCanvas');
    }

    if (this.backButtonSubscription) {
      this.backButtonSubscription.unsubscribe();
    }
    window.removeEventListener('renderer:question:submitscore', () => { });
  }

  ngOnDestroy() {
    if (this.pauseSubscription) {
      this.pauseSubscription.unsubscribe();
    }

  }

  /**
   * This will trigger from player/ iframe when it unable to find consecutive content
   * @param identifier Content Identifier
   * @param hierarchyInfo Object of content hierarchy
   */
  onContentNotFound(identifier: string, hierarchyInfo: Array<HierarchyInfo>) {
    const content = { identifier, hierarchyInfo };

    // Migration todo
    /*     this.navCtrl.push(ContentDetailsPage, {
          content: content
        }).then(() => {
          // Hide player while going back
          this.navCtrl.remove(this.navCtrl.length() - 2);
        });
     */
    this.router.navigate([RouterLinks.CONTENT_DETAILS, identifier], { state: { content, course: this.course }, replaceUrl: true, });
  }

  /**
   * This is an callback to mobile when player switches user
   * @param selectedUser User id of the newly selected user by player
   */
  onUserSwitch(selectedUser: User) {
    this.appGlobalService.setSelectedUser(selectedUser);
  }

  /**
   * This will close the player page and will fire some end telemetry events from the player
   */
  closeIframe() {
    const stageId = this.previewElement.nativeElement.contentWindow['EkstepRendererAPI'].getCurrentStageId() || 'mock';
    try {
      this.previewElement.nativeElement.contentWindow['TelemetryService'].exit(stageId);
    } catch (err) {
      console.error('End telemetry error:', err.message);
    }
    this.events.publish(EventTopics.PLAYER_CLOSED, {
      selectedUser: this.appGlobalService.getSelectedUser()
    });

    this.location.back();
  }


  /**
   * This will show confirmation box while leaving the player, it will fire some telemetry events from the player.
   */
  async showConfirm() {
    (window as any).TTS.speak(`say ok,          to get back to the content details page.      or say,      cancel `);
    const type = (this.previewElement.nativeElement.contentWindow['Renderer']
      && !this.previewElement.nativeElement.contentWindow['Renderer'].running) ? 'EXIT_APP' : 'EXIT_CONTENT';
    const stageId = this.previewElement.nativeElement.contentWindow['EkstepRendererAPI'].getCurrentStageId();
    this.previewElement.nativeElement.contentWindow['TelemetryService'].interact(
      'TOUCH', 'DEVICE_BACK_BTN', 'EXIT', { type: type, stageId: stageId });

    this.alert = await this.alertCtrl.create({
      header: this.commonUtilService.translateMessage('CONFIRM'),
      message: this.commonUtilService.translateMessage('CONTENT_PLAYER_EXIT_PERMISSION'),
      buttons: [
        {
          text: this.commonUtilService.translateMessage('CANCEL'),
          role: 'cancel',
          handler: () => {
            this.previewElement.nativeElement.contentWindow['TelemetryService'].interact(
              'TOUCH', 'ALERT_CANCEL', 'EXIT', { type: type, stageId: stageId });
          }
        },
        {
          text: this.commonUtilService.translateMessage('OKAY'),
          handler: () => {
            this.previewElement.nativeElement.contentWindow['TelemetryService'].interact(
              'END', 'ALERT_OK', 'EXIT', { type: type, stageId: stageId });
            this.previewElement.nativeElement.contentWindow['TelemetryService'].interrupt('OTHER', stageId);
            this.previewElement.nativeElement.contentWindow['EkstepRendererAPI'].dispatchEvent('renderer:telemetry:end');

            this.closeIframe();
          }
        }
      ]
    });
    await this.alert.present();
  }
}
