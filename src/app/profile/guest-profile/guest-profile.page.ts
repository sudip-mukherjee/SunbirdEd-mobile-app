import { SpeechRecognition } from '@ionic-native/speech-recognition/ngx';
import { TranslateService } from '@ngx-translate/core';
import { Component, Inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { Events, ToastController } from '@ionic/angular';
import {
  Framework,
  FrameworkCategoryCodesGroup,
  FrameworkDetailsRequest,
  FrameworkService,
  FrameworkUtilService,
  GetSuggestedFrameworksRequest,
  ProfileService,
  ProfileType,
  SharedPreferences,
  Profile
} from 'sunbird-sdk';
import { ActivatedRoute, Router, NavigationExtras } from '@angular/router';
import { AppGlobalService } from '@app/services/app-global-service.service';
import { CommonUtilService } from '@app/services/common-util.service';
import { TelemetryGeneratorService } from '@app/services/telemetry-generator.service';
import { AppHeaderService } from '@app/services/app-header.service';
import { PageId, Environment, InteractType, InteractSubtype } from '@app/services/telemetry-constants';
import { ProfileConstants, RouterLinks, PreferenceKey } from '@app/app/app.constant';


@Component({
  selector: 'app-guest-profile',
  templateUrl: './guest-profile.page.html',
  styleUrls: ['./guest-profile.page.scss'],
})
export class GuestProfilePage implements OnInit {
  imageUri = 'assets/imgs/ic_profile_default.png';
  ProfileType = ProfileType;
  showSignInCard = false;
  isNetworkAvailable: boolean;
  boards = '';
  grade = '';
  medium = '';
  subjects = '';
  categories: Array<any> = [];
  profile: Profile;
  syllabus = '';
  selectedLanguage: string;
  loader: any;
  headerObservable: any;
  isUpgradePopoverShown = false;
  deviceLocation: any;
  isPermissionAvailable = false;
  storedResult = [];
  isRecording = false;

  constructor(
    @Inject('PROFILE_SERVICE') private profileService: ProfileService,
    @Inject('FRAMEWORK_SERVICE') private frameworkService: FrameworkService,
    @Inject('FRAMEWORK_UTIL_SERVICE') private frameworkUtilService: FrameworkUtilService,
    @Inject('SHARED_PREFERENCES') private preferences: SharedPreferences,
    private events: Events,
    public commonUtilService: CommonUtilService,
    public appGlobalService: AppGlobalService,
    private telemetryGeneratorService: TelemetryGeneratorService,
    private translate: TranslateService,
    private headerService: AppHeaderService,
    public toastController: ToastController,
    private route: ActivatedRoute,
    private router: Router,
    private speechRecognition: SpeechRecognition,
    private changeDetector: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.selectedLanguage = this.translate.currentLang;

    // Event for optional and forceful upgrade
    this.events.subscribe('force_optional_upgrade', async (upgrade) => {
      if (upgrade && !this.isUpgradePopoverShown) {
        await this.appGlobalService.openPopover(upgrade);
        this.isUpgradePopoverShown = true;
      }
    });

    // TODO: Need to make an get Profile user details API call.
    this.refreshProfileData();
    this.events.subscribe('refresh:profile', () => {
      this.refreshProfileData(false, false);
    });

    this.refreshSignInCard();
    this.appGlobalService.generateConfigInteractEvent(PageId.GUEST_PROFILE);
  }

  ionViewWillEnter() {
    this.events.subscribe('update_header', () => {
      this.headerService.showHeaderWithHomeButton(['download']);
    });
    this.headerObservable = this.headerService.headerEventEmitted$.subscribe(eventName => {
      this.handleHeaderEvents(eventName);
    });
    this.headerService.showHeaderWithHomeButton(['download']);
  }

  ionViewWillLeave() {
    if (this.headerObservable) {
      this.headerObservable.unsubscribe();
    }

    if (this.headerObservable) {
      this.headerObservable.unsubscribe();
    }

    this.events.unsubscribe('update_header');
  }

  async refreshProfileData(refresher: any = false, showLoader: boolean = true) {
    this.loader = await this.commonUtilService.getLoader();

    if (showLoader) {
      await this.loader.present();
    }
    if (refresher) {
      this.telemetryGeneratorService.generatePullToRefreshTelemetry(PageId.GUEST_PROFILE, Environment.HOME);
    }
    const deviceLocationInfo = await this.preferences.getString(PreferenceKey.DEVICE_LOCATION).toPromise();
    if (deviceLocationInfo) {
      this.deviceLocation = JSON.parse(deviceLocationInfo);
    }

    this.profileService.getActiveSessionProfile({ requiredFields: ProfileConstants.REQUIRED_FIELDS }).toPromise()
      .then((res: any) => {
        this.profile = res;
        this.getSyllabusDetails();
        this.refreshSignInCard();
        setTimeout(() => {
          if (refresher) { refresher.target.complete(); }
        }, 500);
      })
      .catch(async () => {
        await this.loader.dismiss();
      });
  }

  refreshSignInCard() {
    const profileType = this.appGlobalService.getGuestUserType();

    if ((profileType === ProfileType.TEACHER && this.appGlobalService.DISPLAY_SIGNIN_FOOTER_CARD_IN_PROFILE_TAB_FOR_TEACHER) ||
      (profileType === ProfileType.STUDENT && this.appGlobalService.DISPLAY_SIGNIN_FOOTER_CARD_IN_PROFILE_TAB_FOR_STUDENT)) {
      this.showSignInCard = true;
    } else {
      this.showSignInCard = false;
    }
  }

  editGuestProfile(isChangeRoleRequest: boolean, attribute) {
    const navigationExtras: NavigationExtras = {
      state: {
        profile: this.profile,
        isCurrentUser: true,
        isChangeRoleRequest
      }
    };
    const values = new Map();
    values['optionClicked'] = attribute;
    this.telemetryGeneratorService.generateInteractTelemetry(
      InteractType.TOUCH,
      InteractSubtype.EDIT_CLICKED,
      Environment.HOME,
      PageId.GUEST_PROFILE, undefined, values);
    this.router.navigate([RouterLinks.GUEST_EDIT], navigationExtras);
  }

  getSyllabusDetails() {
    let selectedFrameworkId = '';

    const getSuggestedFrameworksRequest: GetSuggestedFrameworksRequest = {
      language: this.translate.currentLang,
      requiredCategories: FrameworkCategoryCodesGroup.DEFAULT_FRAMEWORK_CATEGORIES
    };
    this.frameworkUtilService.getActiveChannelSuggestedFrameworkList(getSuggestedFrameworksRequest).toPromise()
      .then((result: Framework[]) => {
        if (result && result !== undefined && result.length > 0) {

          result.forEach(element => {

            if (this.profile && this.profile.syllabus && this.profile.syllabus.length && this.profile.syllabus[0] === element.identifier) {
              this.syllabus = element.name;
              selectedFrameworkId = element.identifier;
            }
          });

          if (selectedFrameworkId !== undefined && selectedFrameworkId.length > 0) {
            this.getFrameworkDetails(selectedFrameworkId);
          } else {
            this.loader.dismiss();
          }
        } else {
          this.loader.dismiss();
          this.commonUtilService.showToast(this.commonUtilService.translateMessage('NO_DATA_FOUND'));
        }
      });
  }

  getFrameworkDetails(frameworkId?: string): void {
    const frameworkDetailsRequest: FrameworkDetailsRequest = {
      frameworkId: (this.profile && this.profile.syllabus && this.profile.syllabus[0]) ? this.profile.syllabus[0] : '',
      requiredCategories: FrameworkCategoryCodesGroup.DEFAULT_FRAMEWORK_CATEGORIES
    };
    this.frameworkService.getFrameworkDetails(frameworkDetailsRequest).toPromise()
      .then(async (framework: Framework) => {
        this.categories = framework.categories;

        if (this.profile.board && this.profile.board.length) {
          this.boards = this.getFieldDisplayValues(this.profile.board, 0);
        }
        if (this.profile.medium && this.profile.medium.length) {
          this.medium = this.getFieldDisplayValues(this.profile.medium, 1);
        }
        if (this.profile.grade && this.profile.grade.length) {
          this.grade = this.getFieldDisplayValues(this.profile.grade, 2);
        }
        if (this.profile.subject && this.profile.subject.length) {
          this.subjects = this.getFieldDisplayValues(this.profile.subject, 3);
        }

        await this.loader.dismiss();
      });
  }

  getFieldDisplayValues(field: Array<any>, catIndex: number): string {
    const displayValues = [];
    this.categories[catIndex].terms.forEach(element => {
      if (field.includes(element.code)) {
        displayValues.push(element.name);
      }
    });
    return this.commonUtilService.arrayToString(displayValues);
  }

  buttonClick(isNetAvailable?) {
    this.commonUtilService.showToast('NO_INTERNET_TITLE', false, '', 3000, 'top');
  }

  handleHeaderEvents($event) {
    switch ($event.name) {
      case 'download':
        this.redirectToActiveDownloads();
        break;
    }
  }

  private redirectToActiveDownloads() {
    this.telemetryGeneratorService.generateInteractTelemetry(
      InteractType.TOUCH,
      InteractSubtype.ACTIVE_DOWNLOADS_CLICKED,
      Environment.HOME,
      PageId.GUEST_PROFILE);

    this.router.navigate([RouterLinks.ACTIVE_DOWNLOADS]);
  }

  redirectToDistrictMappingPage() {
    this.telemetryGeneratorService.generateInteractTelemetry(
      InteractType.TOUCH,
      InteractSubtype.EDIT_DISTRICT_MAPPING_CLICKED,
      Environment.HOME,
      PageId.GUEST_PROFILE);

    const navigationExtras: NavigationExtras = {
      state: {
        isShowBackButton: true,
        source: PageId.GUEST_PROFILE
      }
    };
    this.router.navigate([RouterLinks.DISTRICT_MAPPING], navigationExtras);
  }

  startRecording() {
    this.checkPermission();
    if (this.isPermissionAvailable) {
      this.isRecording = true;
      this.speechRecognition.startListening().subscribe(matches => {
        this.storedResult = matches;
        this.changeDetector.detectChanges();
      });
    }
  }

  // stopRecording() {
  //   this.speechRecognition.stopListening().then(() => {
  //     this.isRecording = false;
  //   });
  //   alert(this.showRecordedItems());
  // }

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

  // toggleRecording() {
  //   if (!this.isRecording) {
  //     this.startRecording();
  //   } else {
  //     this.stopRecording();
  //   }
  // }

  showRecordedItems() {
    const result = [];
    this.storedResult.forEach(element => {
      result.push(element);
    });
    result.reduce((acc, i) => {
      if (acc.includes(i)) {
        acc.push(i);
      }
      return acc;
    }, []);

    alert(result);

  }

}
