import { chromium, devices, BrowserContextOptions, Browser } from "playwright";
import { SearchResponse, SearchResult, CommandOptions, HtmlResponse } from "./types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "./logger.js";
import { url } from "inspector";

// 지문 설정 인터페이스
interface FingerprintConfig {
  deviceName: string;
  locale: string;
  timezoneId: string;
  colorScheme: "dark" | "light";
  reducedMotion: "reduce" | "no-preference";
  forcedColors: "active" | "none";
}

// 저장된 상태 파일 인터페이스
interface SavedState {
  fingerprint?: FingerprintConfig;
  googleDomain?: string;
}

/**
 * 호스트 머신의 실제 설정 가져오기
 * @param userLocale 사용자가 지정한 지역 설정 (있는 경우)
 * @returns 호스트 머신 기반의 지문 설정
 */
function getHostMachineConfig(userLocale?: string): FingerprintConfig {
  // 시스템 지역 설정 가져오기
  const systemLocale = userLocale || process.env.LANG || "ko-KR";

  // 시스템 시간대 가져오기
  // Node.js는 시간대 정보를 직접 제공하지 않지만, 시간대 오프셋을 통해 추론할 수 있음
  const timezoneOffset = new Date().getTimezoneOffset();
  let timezoneId = "Asia/Seoul"; // 기본적으로 서울 시간대 사용

  // 시간대 오프셋에 따라 대략적으로 시간대 추론
  // 시간대 오프셋은 분 단위이며, UTC와의 차이값이고, 음수는 동쪽을 의미
  if (timezoneOffset <= -480 && timezoneOffset > -600) {
    // UTC+8 (중국, 싱가포르, 홍콩 등)
    timezoneId = "Asia/Shanghai";
  } else if (timezoneOffset <= -540) {
    // UTC+9 (일본, 한국 등)
    timezoneId = "Asia/Seoul";
  } else if (timezoneOffset <= -420 && timezoneOffset > -480) {
    // UTC+7 (태국, 베트남 등)
    timezoneId = "Asia/Bangkok";
  } else if (timezoneOffset <= 0 && timezoneOffset > -60) {
    // UTC+0 (영국 등)
    timezoneId = "Europe/London";
  } else if (timezoneOffset <= 60 && timezoneOffset > 0) {
    // UTC-1 (유럽 일부 지역)
    timezoneId = "Europe/Berlin";
  } else if (timezoneOffset <= 300 && timezoneOffset > 240) {
    // UTC-5 (미국 동부)
    timezoneId = "America/New_York";
  }

  // 시스템 색상 스키마 감지
  // Node.js는 시스템 색상 스키마를 직접 가져올 수 없으므로, 합리적인 기본값 사용
  // 시간에 따라 추론 가능: 밤에는 다크 모드, 낮에는 라이트 모드
  const hour = new Date().getHours();
  const colorScheme =
    hour >= 19 || hour < 7 ? ("dark" as const) : ("light" as const);

  // 기타 설정은 합리적인 기본값 사용
  const reducedMotion = "no-preference" as const; // 대부분의 사용자는 애니메이션 감소를 활성화하지 않음
  const forcedColors = "none" as const; // 대부분의 사용자는 강제 색상을 활성화하지 않음

  // 적절한 기기 이름 선택
  // 운영체제에 따라 적절한 브라우저 선택
  const platform = os.platform();
  let deviceName = "Desktop Chrome"; // 기본적으로 Chrome 사용

  if (platform === "darwin") {
    // macOS
    deviceName = "Desktop Safari";
  } else if (platform === "win32") {
    // Windows
    deviceName = "Desktop Edge";
  } else if (platform === "linux") {
    // Linux
    deviceName = "Desktop Firefox";
  }

  // 우리가 사용하는 Chrome
  deviceName = "Desktop Chrome";

  return {
    deviceName,
    locale: systemLocale,
    timezoneId,
    colorScheme,
    reducedMotion,
    forcedColors,
  };
}

/**
 * Google 검색을 실행하고 결과 반환
 * @param query 검색 키워드
 * @param options 검색 옵션
 * @returns 검색 결과
 */
export async function googleSearch(
  query: string,
  options: CommandOptions = {},
  existingBrowser?: Browser
): Promise<SearchResponse> {
  // 기본 옵션 설정
  const {
    limit = 10,
    timeout = 60000,
    stateFile = "./browser-state.json",
    noSaveState = false,
    locale = "ko-KR", // 기본적으로 한국어 사용
  } = options;

  // 전달된 headless 매개변수 무시, 항상 헤드리스 모드로 시작
  let useHeadless = true;

  logger.info({ options }, "브라우저 초기화 중...");

  // 상태 파일 존재 여부 확인
  let storageState: string | undefined = undefined;
  let savedState: SavedState = {};

  // 지문 설정 파일 경로
  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");

  if (fs.existsSync(stateFile)) {
    logger.info(
      { stateFile },
      "브라우저 상태 파일을 발견했습니다. 봇 탐지를 피하기 위해 저장된 브라우저 상태를 사용합니다"
    );
    storageState = stateFile;

    // 저장된 지문 설정 로드 시도
    if (fs.existsSync(fingerprintFile)) {
      try {
        const fingerprintData = fs.readFileSync(fingerprintFile, "utf8");
        savedState = JSON.parse(fingerprintData);
        logger.info("저장된 브라우저 지문 설정을 로드했습니다");
      } catch (e) {
        logger.warn({ error: e }, "지문 설정 파일을 로드할 수 없습니다. 새로운 지문을 생성합니다");
      }
    }
  } else {
    logger.info(
      { stateFile },
      "브라우저 상태 파일을 찾을 수 없습니다. 새로운 브라우저 세션과 지문을 생성합니다"
    );
  }

  // 데스크톱 기기 목록만 사용
  const deviceList = [
    "Desktop Chrome",
    "Desktop Edge",
    "Desktop Firefox",
    "Desktop Safari",
  ];

  // 시간대 목록
  const timezoneList = [
    "America/New_York",
    "Europe/London",
    "Asia/Shanghai",
    "Europe/Berlin",
    "Asia/Seoul",
  ];

  // Google 도메인 목록
  const googleDomains = [
    "https://www.google.com",
    "https://www.google.co.uk",
    "https://www.google.ca",
    "https://www.google.com.au",
  ];

  // 랜덤 기기 설정 가져오기 또는 저장된 설정 사용
  const getDeviceConfig = (): [string, any] => {
    if (
      savedState.fingerprint?.deviceName &&
      devices[savedState.fingerprint.deviceName]
    ) {
      // 저장된 기기 설정 사용
      return [
        savedState.fingerprint.deviceName,
        devices[savedState.fingerprint.deviceName],
      ];
    } else {
      // 랜덤하게 기기 선택
      const randomDevice =
        deviceList[Math.floor(Math.random() * deviceList.length)];
      return [randomDevice, devices[randomDevice]];
    }
  };

  // 랜덤 지연 시간 가져오기
  const getRandomDelay = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  // 검색을 실행하는 함수 정의, 헤드리스와 헤드 모드에서 재사용 가능
  async function performSearch(headless: boolean): Promise<SearchResponse> {
    let browser: Browser;
    let browserWasProvided = false;

    if (existingBrowser) {
      browser = existingBrowser;
      browserWasProvided = true;
      logger.info("기존 브라우저 인스턴스 사용");
    } else {
      logger.info(
        { headless },
        `브라우저를 ${headless ? "헤드리스" : "헤드"} 모드로 시작 준비 중...`
      );

      // 브라우저 초기화, 탐지를 피하기 위해 더 많은 매개변수 추가
      browser = await chromium.launch({
        headless,
        timeout: timeout * 2, // 브라우저 시작 타임아웃 시간 증가
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-site-isolation-trials",
          "--disable-web-security",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          "--hide-scrollbars",
          "--mute-audio",
          "--disable-background-networking",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-breakpad",
          "--disable-component-extensions-with-background-pages",
          "--disable-extensions",
          "--disable-features=TranslateUI",
          "--disable-ipc-flooding-protection",
          "--disable-renderer-backgrounding",
          "--enable-features=NetworkService,NetworkServiceInProcess",
          "--force-color-profile=srgb",
          "--metrics-recording-only",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
      });

      logger.info("브라우저가 성공적으로 시작되었습니다!");
    }

    // 기기 설정 가져오기 - 저장된 것 또는 랜덤 생성
    const [deviceName, deviceConfig] = getDeviceConfig();

    // 브라우저 컨텍스트 옵션 생성
    let contextOptions: BrowserContextOptions = {
      ...deviceConfig,
    };

    // 저장된 지문 설정이 있으면 사용하고, 없으면 호스트 머신의 실제 설정 사용
    if (savedState.fingerprint) {
      contextOptions = {
        ...contextOptions,
        locale: savedState.fingerprint.locale,
        timezoneId: savedState.fingerprint.timezoneId,
        colorScheme: savedState.fingerprint.colorScheme,
        reducedMotion: savedState.fingerprint.reducedMotion,
        forcedColors: savedState.fingerprint.forcedColors,
      };
      logger.info("저장된 브라우저 지문 설정 사용");
    } else {
      // 호스트 머신의 실제 설정 가져오기
      const hostConfig = getHostMachineConfig(locale);

      // 다른 기기 유형을 사용해야 하는 경우, 기기 설정을 다시 가져오기
      if (hostConfig.deviceName !== deviceName) {
        logger.info(
          { deviceType: hostConfig.deviceName },
          "호스트 머신 설정에 따라 기기 유형 사용"
        );
        // 새로운 기기 설정 사용
        contextOptions = { ...devices[hostConfig.deviceName] };
      }

      contextOptions = {
        ...contextOptions,
        locale: hostConfig.locale,
        timezoneId: hostConfig.timezoneId,
        colorScheme: hostConfig.colorScheme,
        reducedMotion: hostConfig.reducedMotion,
        forcedColors: hostConfig.forcedColors,
      };

      // 새로 생성된 지문 설정 저장
      savedState.fingerprint = hostConfig;
      logger.info(
        {
          locale: hostConfig.locale,
          timezone: hostConfig.timezoneId,
          colorScheme: hostConfig.colorScheme,
          deviceType: hostConfig.deviceName,
        },
        "호스트 머신에 따라 새로운 브라우저 지문 설정을 생성했습니다"
      );
    }

    // 일반 옵션 추가 - 데스크톱 설정 사용 보장
    contextOptions = {
      ...contextOptions,
      permissions: ["geolocation", "notifications"],
      acceptDownloads: true,
      isMobile: false, // 데스크톱 모드 강제 사용
      hasTouch: false, // 터치 기능 비활성화
      javaScriptEnabled: true,
    };

    if (storageState) {
      logger.info("저장된 브라우저 상태를 로딩 중...");
    }

    const context = await browser.newContext(
      storageState ? { ...contextOptions, storageState } : contextOptions
    );

    // 탐지를 피하기 위해 추가 브라우저 속성 설정
    await context.addInitScript(() => {
      // navigator 속성 덮어쓰기
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en", "zh-CN"],
      });

      // window 속성 덮어쓰기
      // @ts-ignore - chrome 속성이 존재하지 않는 오류 무시
      window.chrome = {
        runtime: {},
        loadTimes: function () {},
        csi: function () {},
        app: {},
      };

      // WebGL 지문 랜덤화 추가
      if (typeof WebGLRenderingContext !== "undefined") {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (
          parameter: number
        ) {
          // UNMASKED_VENDOR_WEBGL과 UNMASKED_RENDERER_WEBGL 랜덤화
          if (parameter === 37445) {
            return "Intel Inc.";
          }
          if (parameter === 37446) {
            return "Intel Iris OpenGL Engine";
          }
          return getParameter.call(this, parameter);
        };
      }
    });

    const page = await context.newPage();

    // 페이지 추가 속성 설정
    await page.addInitScript(() => {
      // 실제 화면 크기와 색상 깊이 시뮬레이션
      Object.defineProperty(window.screen, "width", { get: () => 1920 });
      Object.defineProperty(window.screen, "height", { get: () => 1080 });
      Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
      Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
    });

    try {
      // 저장된 Google 도메인 사용 또는 랜덤 선택
      let selectedDomain: string;
      if (savedState.googleDomain) {
        selectedDomain = savedState.googleDomain;
        logger.info({ domain: selectedDomain }, "저장된 Google 도메인 사용");
      } else {
        selectedDomain =
          googleDomains[Math.floor(Math.random() * googleDomains.length)];
        // 선택된 도메인 저장
        savedState.googleDomain = selectedDomain;
        logger.info({ domain: selectedDomain }, "Google 도메인을 랜덤하게 선택");
      }

      logger.info("Google 검색 페이지에 접근 중...");

      // Google 검색 페이지 접근
      const response = await page.goto(selectedDomain, {
        timeout,
        waitUntil: "networkidle",
      });

      // 사람 확인 페이지로 리디렉션되었는지 확인
      const currentUrl = page.url();
      const sorryPatterns = [
        "google.com/sorry/index",
        "google.com/sorry",
        "recaptcha",
        "captcha",
        "unusual traffic",
      ];

      const isBlockedPage = sorryPatterns.some(
        (pattern) =>
          currentUrl.includes(pattern) ||
          (response && response.url().toString().includes(pattern))
      );

      if (isBlockedPage) {
        if (headless) {
          logger.warn("检测到人机验证页面，将以有头模式重新启动浏览器...");

          // 현재 페이지와 컨텍스트 닫기
          await page.close();
          await context.close();

          // 외부에서 제공된 브라우저인 경우, 닫지 않고 새로운 브라우저 인스턴스 생성
          if (browserWasProvided) {
            logger.info(
              "使用外部浏览器实例时遇到人机验证，创建新的浏览器实例..."
            );
            // 새로운 브라우저 인스턴스 생성, 외부에서 제공된 인스턴스 사용 중단
            const newBrowser = await chromium.launch({
              headless: false, // 헤드 모드 사용
              timeout: timeout * 2,
              args: [
                "--disable-blink-features=AutomationControlled",
                // 다른 매개변수는 원래와 동일
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-site-isolation-trials",
                "--disable-web-security",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--hide-scrollbars",
                "--mute-audio",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-breakpad",
                "--disable-component-extensions-with-background-pages",
                "--disable-extensions",
                "--disable-features=TranslateUI",
                "--disable-ipc-flooding-protection",
                "--disable-renderer-backgrounding",
                "--enable-features=NetworkService,NetworkServiceInProcess",
                "--force-color-profile=srgb",
                "--metrics-recording-only",
              ],
              ignoreDefaultArgs: ["--enable-automation"],
            });

            // 새로운 브라우저 인스턴스로 검색 실행
            try {
              const tempContext = await newBrowser.newContext(contextOptions);
              const tempPage = await tempContext.newPage();

              // 여기에 사람 확인 처리 코드를 추가할 수 있음
              // ...

              // 완료 후 임시 브라우저 닫기
              await newBrowser.close();

              // 검색 다시 실행
              return performSearch(false);
            } catch (error) {
              await newBrowser.close();
              throw error;
            }
          } else {
            // 외부에서 제공되지 않은 브라우저인 경우, 직접 닫고 검색 다시 실행
            await browser.close();
            return performSearch(false); // 헤드 모드로 검색 다시 실행
          }
        } else {
          logger.warn("检测到人机验证页面，请在浏览器中完成验证...");
          // 사용자가 확인을 완료하고 검색 페이지로 리디렉션될 때까지 대기
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern)
              );
            },
          });
          logger.info("人机验证已完成，继续搜索...");
        }
      }

      logger.info({ query }, "검색 키워드 입력 중");

      // 검색 상자 나타날 때까지 대기 - 여러 가능한 선택자 시도
      const searchInputSelectors = [
        "textarea[name='q']",
        "input[name='q']",
        "textarea[title='Search']",
        "input[title='Search']",
        "textarea[aria-label='Search']",
        "input[aria-label='Search']",
        "textarea",
      ];

      let searchInput = null;
      for (const selector of searchInputSelectors) {
        searchInput = await page.$(selector);
        if (searchInput) {
          logger.info({ selector }, "找到搜索框");
          break;
        }
      }

      if (!searchInput) {
        logger.error("无法找到搜索框");
        throw new Error("无法找到搜索框");
      }

      // 검색 상자를 직접 클릭하여 지연 시간 줄이기
      await searchInput.click();

      // 문자별로 입력하지 않고 전체 쿼리 문자열을 직접 입력
      await page.keyboard.type(query, { delay: getRandomDelay(10, 30) });

      // 엔터키 누르기 전 지연 시간 줄이기
      await page.waitForTimeout(getRandomDelay(100, 300));
      await page.keyboard.press("Enter");

      logger.info("페이지 로딩 완료를 기다리는 중...");

      // 페이지 로딩 완료 대기
      await page.waitForLoadState("networkidle", { timeout });

      // 검색 후 URL이 사람 확인 페이지로 리디렉션되었는지 확인
      const searchUrl = page.url();
      const isBlockedAfterSearch = sorryPatterns.some((pattern) =>
        searchUrl.includes(pattern)
      );

      if (isBlockedAfterSearch) {
        if (headless) {
          logger.warn(
            "搜索后检测到人机验证页面，将以有头模式重新启动浏览器..."
          );

          // 현재 페이지와 컨텍스트 닫기
          await page.close();
          await context.close();

          // 외부에서 제공된 브라우저인 경우, 닫지 않고 새로운 브라우저 인스턴스 생성
          if (browserWasProvided) {
            logger.info(
              "使用外部浏览器实例时搜索后遇到人机验证，创建新的浏览器实例..."
            );
            // 새로운 브라우저 인스턴스 생성, 외부에서 제공된 인스턴스 사용 중단
            const newBrowser = await chromium.launch({
              headless: false, // 헤드 모드 사용
              timeout: timeout * 2,
              args: [
                "--disable-blink-features=AutomationControlled",
                // 다른 매개변수는 원래와 동일
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-site-isolation-trials",
                "--disable-web-security",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--hide-scrollbars",
                "--mute-audio",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-breakpad",
                "--disable-component-extensions-with-background-pages",
                "--disable-extensions",
                "--disable-features=TranslateUI",
                "--disable-ipc-flooding-protection",
                "--disable-renderer-backgrounding",
                "--enable-features=NetworkService,NetworkServiceInProcess",
                "--force-color-profile=srgb",
                "--metrics-recording-only",
              ],
              ignoreDefaultArgs: ["--enable-automation"],
            });

            // 새로운 브라우저 인스턴스로 검색 실행
            try {
              const tempContext = await newBrowser.newContext(contextOptions);
              const tempPage = await tempContext.newPage();

              // 여기에 사람 확인 처리 코드를 추가할 수 있음
              // ...

              // 완료 후 임시 브라우저 닫기
              await newBrowser.close();

              // 검색 다시 실행
              return performSearch(false);
            } catch (error) {
              await newBrowser.close();
              throw error;
            }
          } else {
            // 외부에서 제공되지 않은 브라우저인 경우, 직접 닫고 검색 다시 실행
            await browser.close();
            return performSearch(false); // 헤드 모드로 검색 다시 실행
          }
        } else {
          logger.warn("搜索后检测到人机验证页面，请在浏览器中完成验证...");
          // 사용자가 확인을 완료하고 검색 페이지로 리디렉션될 때까지 대기
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern)
              );
            },
          });
          logger.info("人机验证已完成，继续搜索...");

          // 페이지 다시 로딩 대기
          await page.waitForLoadState("networkidle", { timeout });
        }
      }

      logger.info({ url: page.url() }, "正在等待搜索结果加载...");

      // 여러 가능한 검색 결과 선택자 시도
      const searchResultSelectors = [
        "#search",
        "#rso",
        ".g",
        "[data-sokoban-container]",
        "div[role='main']",
      ];

      let resultsFound = false;
      for (const selector of searchResultSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: timeout / 2 });
          logger.info({ selector }, "找到搜索结果");
          resultsFound = true;
          break;
        } catch (e) {
          // 다음 선택자 계속 시도
        }
      }

      if (!resultsFound) {
        // 검색 결과를 찾을 수 없는 경우, 사람 확인 페이지로 리디렉션되었는지 확인
        const currentUrl = page.url();
        const isBlockedDuringResults = sorryPatterns.some((pattern) =>
          currentUrl.includes(pattern)
        );

        if (isBlockedDuringResults) {
          if (headless) {
            logger.warn(
              "等待搜索结果时检测到人机验证页面，将以有头模式重新启动浏览器..."
            );

            // 현재 페이지와 컨텍스트 닫기
            await page.close();
            await context.close();

            // 외부에서 제공된 브라우저인 경우, 닫지 않고 새로운 브라우저 인스턴스 생성
            if (browserWasProvided) {
              logger.info(
                "使用外部浏览器实例时等待搜索结果遇到人机验证，创建新的浏览器实例..."
              );
              // 새로운 브라우저 인스턴스 생성, 외부에서 제공된 인스턴스 사용 중단
              const newBrowser = await chromium.launch({
                headless: false, // 헤드 모드 사용
                timeout: timeout * 2,
                args: [
                  "--disable-blink-features=AutomationControlled",
                  // 다른 매개변수는 원래와 동일
                  "--disable-features=IsolateOrigins,site-per-process",
                  "--disable-site-isolation-trials",
                  "--disable-web-security",
                  "--no-sandbox",
                  "--disable-setuid-sandbox",
                  "--disable-dev-shm-usage",
                  "--disable-accelerated-2d-canvas",
                  "--no-first-run",
                  "--no-zygote",
                  "--disable-gpu",
                  "--hide-scrollbars",
                  "--mute-audio",
                  "--disable-background-networking",
                  "--disable-background-timer-throttling",
                  "--disable-backgrounding-occluded-windows",
                  "--disable-breakpad",
                  "--disable-component-extensions-with-background-pages",
                  "--disable-extensions",
                  "--disable-features=TranslateUI",
                  "--disable-ipc-flooding-protection",
                  "--disable-renderer-backgrounding",
                  "--enable-features=NetworkService,NetworkServiceInProcess",
                  "--force-color-profile=srgb",
                  "--metrics-recording-only",
                ],
                ignoreDefaultArgs: ["--enable-automation"],
              });

              // 새로운 브라우저 인스턴스로 검색 실행
              try {
                const tempContext = await newBrowser.newContext(contextOptions);
                const tempPage = await tempContext.newPage();

                // 여기에 사람 확인 처리 코드를 추가할 수 있음
                // ...

                // 완료 후 임시 브라우저 닫기
                await newBrowser.close();

                // 검색 다시 실행
                return performSearch(false);
              } catch (error) {
                await newBrowser.close();
                throw error;
              }
            } else {
              // 외부에서 제공되지 않은 브라우저인 경우, 직접 닫고 검색 다시 실행
              await browser.close();
              return performSearch(false); // 헤드 모드로 검색 다시 실행
            }
          } else {
            logger.warn(
              "等待搜索结果时检测到人机验证页面，请在浏览器中完成验证..."
            );
            // 사용자가 확인을 완료하고 검색 페이지로 리디렉션될 때까지 대기
            await page.waitForNavigation({
              timeout: timeout * 2,
              url: (url) => {
                const urlStr = url.toString();
                return sorryPatterns.every(
                  (pattern) => !urlStr.includes(pattern)
                );
              },
            });
            logger.info("人机验证已完成，继续搜索...");

            // 검색 결과 대기 다시 시도
            for (const selector of searchResultSelectors) {
              try {
                await page.waitForSelector(selector, { timeout: timeout / 2 });
                logger.info({ selector }, "验证后找到搜索结果");
                resultsFound = true;
                break;
              } catch (e) {
                // 다음 선택자 계속 시도
              }
            }

            if (!resultsFound) {
              logger.error("无法找到搜索结果元素");
              throw new Error("无法找到搜索结果元素");
            }
          }
        } else {
          // 사람 확인 문제가 아닌 경우, 오류 발생
          logger.error("无法找到搜索结果元素");
          throw new Error("无法找到搜索结果元素");
        }
      }

      // 대기 시간 줄이기
      await page.waitForTimeout(getRandomDelay(200, 500));

      logger.info("正在提取搜索结果...");

      let results: SearchResult[] = []; // evaluate 호출 전에 results 선언

      // 검색 결과 추출 - google-search-extractor.cjs에서 이식된 로직 사용
      results = await page.evaluate((maxResults: number): SearchResult[] => { // 반환 타입 추가
        const results: { title: string; link: string; snippet: string }[] = [];
        const seenUrls = new Set<string>(); // 중복 제거용

        // 여러 그룹의 선택자 정의, 우선순위별로 정렬 (google-search-extractor.cjs 참조)
        const selectorSets = [
          { container: '#search div[data-hveid]', title: 'h3', snippet: '.VwiC3b' },
          { container: '#rso div[data-hveid]', title: 'h3', snippet: '[data-sncf="1"]' },
          { container: '.g', title: 'h3', snippet: 'div[style*="webkit-line-clamp"]' },
          { container: 'div[jscontroller][data-hveid]', title: 'h3', snippet: 'div[role="text"]' }
        ];

        // 대체 요약 선택자
        const alternativeSnippetSelectors = [
          '.VwiC3b',
          '[data-sncf="1"]',
          'div[style*="webkit-line-clamp"]',
          'div[role="text"]'
        ];

        // 각 그룹의 선택자 시도
        for (const selectors of selectorSets) {
          if (results.length >= maxResults) break; // 수량 제한에 도달한 경우 중지

          const containers = document.querySelectorAll(selectors.container);

          for (const container of containers) {
            if (results.length >= maxResults) break;

            const titleElement = container.querySelector(selectors.title);
            if (!titleElement) continue;

            const title = (titleElement.textContent || "").trim();

            // 링크 찾기
            let link = '';
            const linkInTitle = titleElement.querySelector('a');
            if (linkInTitle) {
              link = linkInTitle.href;
            } else {
              let current: Element | null = titleElement;
              while (current && current.tagName !== 'A') {
                current = current.parentElement;
              }
              if (current && current instanceof HTMLAnchorElement) {
                link = current.href;
              } else {
                const containerLink = container.querySelector('a');
                if (containerLink) {
                  link = containerLink.href;
                }
              }
            }

            // 유효하지 않거나 중복된 링크 필터링
            if (!link || !link.startsWith('http') || seenUrls.has(link)) continue;

            // 요약 찾기
            let snippet = '';
            const snippetElement = container.querySelector(selectors.snippet);
            if (snippetElement) {
              snippet = (snippetElement.textContent || "").trim();
            } else {
              // 다른 요약 선택자 시도
              for (const altSelector of alternativeSnippetSelectors) {
                const element = container.querySelector(altSelector);
                if (element) {
                  snippet = (element.textContent || "").trim();
                  break;
                }
              }

              // 여전히 요약을 찾지 못한 경우, 일반적인 방법 시도
              if (!snippet) {
                const textNodes = Array.from(container.querySelectorAll('div')).filter(el =>
                  !el.querySelector('h3') &&
                  (el.textContent || "").trim().length > 20
                );
                if (textNodes.length > 0) {
                  snippet = (textNodes[0].textContent || "").trim();
                }
              }
            }

            // 제목과 링크가 있는 결과만 추가
            if (title && link) {
              results.push({ title, link, snippet });
              seenUrls.add(link); // 처리된 URL 기록
            }
          }
        }
        
        // 주요 선택자로 충분한 결과를 찾지 못한 경우, 더 일반적인 방법 시도 (보완용)
        if (results.length < maxResults) {
            const anchorElements = Array.from(document.querySelectorAll("a[href^='http']"));
            for (const el of anchorElements) {
                if (results.length >= maxResults) break;

                // el이 HTMLAnchorElement인지 확인
                if (!(el instanceof HTMLAnchorElement)) {
                    continue;
                }
                const link = el.href;
                // 네비게이션 링크, 이미지 링크, 기존 링크 등 필터링
                if (!link || seenUrls.has(link) || link.includes("google.com/") || link.includes("accounts.google") || link.includes("support.google")) {
                    continue;
                }

                const title = (el.textContent || "").trim();
                if (!title) continue; // 텍스트 내용이 없는 링크 건너뛰기

                // 주변 텍스트를 요약으로 가져오기 시도
                let snippet = "";
                let parent = el.parentElement;
                for (let i = 0; i < 3 && parent; i++) {
                  const text = (parent.textContent || "").trim();
                  // 요약 텍스트가 제목과 다르고 일정한 길이를 갖도록 보장
                  if (text.length > 20 && text !== title) {
                    snippet = text;
                    break; // 적절한 요약을 찾으면 위쪽 검색 중지
                  }
                  parent = parent.parentElement;
                }

                results.push({ title, link, snippet });
                seenUrls.add(link);
            }
        }

        return results.slice(0, maxResults); // 제한을 초과하지 않도록 보장
      }, limit); // limit을 evaluate 함수에 전달

      logger.info({ count: results.length }, "검색 결과를 성공적으로 가져왔습니다");

      try {
        // 브라우저 상태 저장 (사용자가 저장하지 않도록 지정하지 않은 경우)
        if (!noSaveState) {
          logger.info({ stateFile }, "正在保存浏览器状态...");

          // 디렉토리 존재 확인
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }

          // 상태 저장
          await context.storageState({ path: stateFile });
          logger.info("브라우저 상태 저장 성공!");

          // 지문 설정 저장
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8"
            );
            logger.info({ fingerprintFile }, "지문 설정이 저장되었습니다");
          } catch (fingerprintError) {
            logger.error({ error: fingerprintError }, "지문 설정 저장 중 오류 발생");
          }
        } else {
          logger.info("사용자 설정에 따라 브라우저 상태를 저장하지 않습니다");
        }
      } catch (error) {
        logger.error({ error }, "保存浏览器状态时发生错误");
      }

      // 브라우저가 외부에서 제공되지 않은 경우에만 브라우저 닫기
      if (!browserWasProvided) {
        logger.info("브라우저를 종료하는 중...");
        await browser.close();
      } else {
        logger.info("브라우저 인스턴스를 열린 상태로 유지");
      }

      // 검색 결과 반환
      return {
        query,
        results, // 이제 results가 이 스코프에서 접근 가능함
      };
    } catch (error) {
      logger.error({ error }, "搜索过程中发生错误");

      try {
        // 오류가 발생해도 브라우저 상태 저장 시도
        if (!noSaveState) {
          logger.info({ stateFile }, "正在保存浏览器状态...");
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }
          await context.storageState({ path: stateFile });

          // 지문 설정 저장
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8"
            );
            logger.info({ fingerprintFile }, "지문 설정이 저장되었습니다");
          } catch (fingerprintError) {
            logger.error({ error: fingerprintError }, "지문 설정 저장 중 오류 발생");
          }
        }
      } catch (stateError) {
        logger.error({ error: stateError }, "保存浏览器状态时发生错误");
      }

      // 브라우저가 외부에서 제공되지 않은 경우에만 브라우저 닫기
      if (!browserWasProvided) {
        logger.info("브라우저를 종료하는 중...");
        await browser.close();
      } else {
        logger.info("브라우저 인스턴스를 열린 상태로 유지");
      }

      // 오류 정보 또는 빈 결과 반환
      // logger.error가 이미 오류를 기록했으므로, 여기서는 오류 정보가 포함된 시뮬레이션 결과 반환
       return {
         query,
         results: [
           {
             title: "搜索失败",
             link: "",
             snippet: `无法完成搜索，错误信息: ${
               error instanceof Error ? error.message : String(error)
             }`,
           },
         ],
       };
    }
    // finally 블록 제거, 리소스 정리가 이미 try와 catch 블록에서 처리됨
  }

  // 먼저 헤드리스 모드로 실행 시도搜索
  return performSearch(useHeadless);
}

/**
 * 获取Google搜索结果页面的原始HTML
 * @param query 搜索关键词
 * @param options 搜索选项
 * @param saveToFile 是否将HTML保存到文件（可选）
 * @param outputPath HTML输出文件路径（可选，默认为'./google-search-html/[query]-[timestamp].html'）
 * @returns 包含HTML内容的响应对象
 */
export async function getGoogleSearchPageHtml(
  query: string,
  options: CommandOptions = {},
  saveToFile: boolean = false,
  outputPath?: string
): Promise<HtmlResponse> {
  // 기본 옵션 설정, googleSearch와 일치하도록 유지
  const {
    timeout = 60000,
    stateFile = "./browser-state.json",
    noSaveState = false,
    locale = "ko-KR", // 기본적으로 한국어 사용
  } = options;

  // 전달된 headless 매개변수 무시, 항상 헤드리스 모드로 시작
  let useHeadless = true;

  logger.info({ options }, "검색 페이지 HTML을 가져오기 위해 브라우저 초기화 중...");

  // googleSearch의 브라우저 초기화 코드 재사용
  // 상태 파일 존재 여부 확인
  let storageState: string | undefined = undefined;
  let savedState: SavedState = {};

  // 지문 설정 파일 경로
  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");

  if (fs.existsSync(stateFile)) {
    logger.info(
      { stateFile },
      "发现浏览器状态文件，将使用保存的浏览器状态以避免反机器人检测"
    );
    storageState = stateFile;

    // 저장된 지문 설정 로드 시도
    if (fs.existsSync(fingerprintFile)) {
      try {
        const fingerprintData = fs.readFileSync(fingerprintFile, "utf8");
        savedState = JSON.parse(fingerprintData);
        logger.info("已加载保存的浏览器指纹配置");
      } catch (e) {
        logger.warn({ error: e }, "无法加载指纹配置文件，将创建新的指纹");
      }
    }
  } else {
    logger.info(
      { stateFile },
      "未找到浏览器状态文件，将创建新的浏览器会话和指纹"
    );
  }

  // 데스크톱 기기 목록만 사용
  const deviceList = [
    "Desktop Chrome",
    "Desktop Edge",
    "Desktop Firefox",
    "Desktop Safari",
  ];

  // Google 도메인 목록
  const googleDomains = [
    "https://www.google.com",
    "https://www.google.co.uk",
    "https://www.google.ca",
    "https://www.google.com.au",
  ];

  // 랜덤 기기 설정 가져오기 또는 저장된 설정 사용
  const getDeviceConfig = (): [string, any] => {
    if (
      savedState.fingerprint?.deviceName &&
      devices[savedState.fingerprint.deviceName]
    ) {
      // 저장된 기기 설정 사용
      return [
        savedState.fingerprint.deviceName,
        devices[savedState.fingerprint.deviceName],
      ];
    } else {
      // 랜덤하게 기기 선택
      const randomDevice =
        deviceList[Math.floor(Math.random() * deviceList.length)];
      return [randomDevice, devices[randomDevice]];
    }
  };

  // 랜덤 지연 시간 가져오기
  const getRandomDelay = (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  // HTML을 가져오기 위한 전용 함수 정의
  async function performSearchAndGetHtml(headless: boolean): Promise<HtmlResponse> {
    let browser: Browser;
    
    // 브라우저 초기화, 탐지를 피하기 위해 더 많은 매개변수 추가
    browser = await chromium.launch({
      headless,
      timeout: timeout * 2, // 브라우저 시작 타임아웃 시간 증가
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-site-isolation-trials",
        "--disable-web-security",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--hide-scrollbars",
        "--mute-audio",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-breakpad",
        "--disable-component-extensions-with-background-pages",
        "--disable-extensions",
        "--disable-features=TranslateUI",
        "--disable-ipc-flooding-protection",
        "--disable-renderer-backgrounding",
        "--enable-features=NetworkService,NetworkServiceInProcess",
        "--force-color-profile=srgb",
        "--metrics-recording-only",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    logger.info("브라우저가 성공적으로 시작되었습니다!");

    // 기기 설정 가져오기 - 저장된 것 또는 랜덤 생성
    const [deviceName, deviceConfig] = getDeviceConfig();

    // 브라우저 컨텍스트 옵션 생성
    let contextOptions: BrowserContextOptions = {
      ...deviceConfig,
    };

    // 저장된 지문 설정이 있으면 사용하고, 없으면 호스트 머신의 실제 설정 사용
    if (savedState.fingerprint) {
      contextOptions = {
        ...contextOptions,
        locale: savedState.fingerprint.locale,
        timezoneId: savedState.fingerprint.timezoneId,
        colorScheme: savedState.fingerprint.colorScheme,
        reducedMotion: savedState.fingerprint.reducedMotion,
        forcedColors: savedState.fingerprint.forcedColors,
      };
      logger.info("저장된 브라우저 지문 설정 사용");
    } else {
      // 호스트 머신의 실제 설정 가져오기
      const hostConfig = getHostMachineConfig(locale);

      // 다른 기기 유형을 사용해야 하는 경우, 기기 설정을 다시 가져오기
      if (hostConfig.deviceName !== deviceName) {
        logger.info(
          { deviceType: hostConfig.deviceName },
          "호스트 머신 설정에 따라 기기 유형 사용"
        );
        // 새로운 기기 설정 사용
        contextOptions = { ...devices[hostConfig.deviceName] };
      }

      contextOptions = {
        ...contextOptions,
        locale: hostConfig.locale,
        timezoneId: hostConfig.timezoneId,
        colorScheme: hostConfig.colorScheme,
        reducedMotion: hostConfig.reducedMotion,
        forcedColors: hostConfig.forcedColors,
      };

      // 새로 생성된 지문 설정 저장
      savedState.fingerprint = hostConfig;
      logger.info(
        {
          locale: hostConfig.locale,
          timezone: hostConfig.timezoneId,
          colorScheme: hostConfig.colorScheme,
          deviceType: hostConfig.deviceName,
        },
        "호스트 머신에 따라 새로운 브라우저 지문 설정을 생성했습니다"
      );
    }

    // 일반 옵션 추가 - 데스크톱 설정 사용 보장
    contextOptions = {
      ...contextOptions,
      permissions: ["geolocation", "notifications"],
      acceptDownloads: true,
      isMobile: false, // 데스크톱 모드 강제 사용
      hasTouch: false, // 터치 기능 비활성화
      javaScriptEnabled: true,
    };

    if (storageState) {
      logger.info("저장된 브라우저 상태를 로딩 중...");
    }

    const context = await browser.newContext(
      storageState ? { ...contextOptions, storageState } : contextOptions
    );

    // 탐지를 피하기 위해 추가 브라우저 속성 설정
    await context.addInitScript(() => {
      // navigator 속성 덮어쓰기
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en", "zh-CN"],
      });

      // window 속성 덮어쓰기
      // @ts-ignore - chrome 속성이 존재하지 않는 오류 무시
      window.chrome = {
        runtime: {},
        loadTimes: function () {},
        csi: function () {},
        app: {},
      };

      // WebGL 지문 랜덤화 추가
      if (typeof WebGLRenderingContext !== "undefined") {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (
          parameter: number
        ) {
          // UNMASKED_VENDOR_WEBGL과 UNMASKED_RENDERER_WEBGL 랜덤화
          if (parameter === 37445) {
            return "Intel Inc.";
          }
          if (parameter === 37446) {
            return "Intel Iris OpenGL Engine";
          }
          return getParameter.call(this, parameter);
        };
      }
    });

    const page = await context.newPage();

    // 페이지 추가 속성 설정
    await page.addInitScript(() => {
      // 실제 화면 크기와 색상 깊이 시뮬레이션
      Object.defineProperty(window.screen, "width", { get: () => 1920 });
      Object.defineProperty(window.screen, "height", { get: () => 1080 });
      Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
      Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
    });

    try {
      // 저장된 Google 도메인 사용 또는 랜덤 선택
      let selectedDomain: string;
      if (savedState.googleDomain) {
        selectedDomain = savedState.googleDomain;
        logger.info({ domain: selectedDomain }, "저장된 Google 도메인 사용");
      } else {
        selectedDomain =
          googleDomains[Math.floor(Math.random() * googleDomains.length)];
        // 선택된 도메인 저장
        savedState.googleDomain = selectedDomain;
        logger.info({ domain: selectedDomain }, "Google 도메인을 랜덤하게 선택");
      }

      logger.info("Google 검색 페이지에 접근 중...");

      // Google 검색 페이지 접근
      const response = await page.goto(selectedDomain, {
        timeout,
        waitUntil: "networkidle",
      });

      // 사람 확인 페이지로 리디렉션되었는지 확인
      const currentUrl = page.url();
      const sorryPatterns = [
        "google.com/sorry/index",
        "google.com/sorry",
        "recaptcha",
        "captcha",
        "unusual traffic",
      ];

      const isBlockedPage = sorryPatterns.some(
        (pattern) =>
          currentUrl.includes(pattern) ||
          (response && response.url().toString().includes(pattern))
      );

      if (isBlockedPage) {
        if (headless) {
          logger.warn("检测到人机验证页面，将以有头模式重新启动浏览器...");

          // 현재 페이지와 컨텍스트 닫기
          await page.close();
          await context.close();
          await browser.close();
          
          // 헤드 모드로 다시 실행
          return performSearchAndGetHtml(false);
        } else {
          logger.warn("检测到人机验证页面，请在浏览器中完成验证...");
          // 사용자가 확인을 완료하고 검색 페이지로 리디렉션될 때까지 대기
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern)
              );
            },
          });
          logger.info("人机验证已完成，继续搜索...");
        }
      }

      logger.info({ query }, "검색 키워드 입력 중");

      // 검색 상자 나타날 때까지 대기 - 여러 가능한 선택자 시도
      const searchInputSelectors = [
        "textarea[name='q']",
        "input[name='q']",
        "textarea[title='Search']",
        "input[title='Search']",
        "textarea[aria-label='Search']",
        "input[aria-label='Search']",
        "textarea",
      ];

      let searchInput = null;
      for (const selector of searchInputSelectors) {
        searchInput = await page.$(selector);
        if (searchInput) {
          logger.info({ selector }, "找到搜索框");
          break;
        }
      }

      if (!searchInput) {
        logger.error("无法找到搜索框");
        throw new Error("无法找到搜索框");
      }

      // 검색 상자를 직접 클릭하여 지연 시간 줄이기
      await searchInput.click();

      // 문자별로 입력하지 않고 전체 쿼리 문자열을 직접 입력
      await page.keyboard.type(query, { delay: getRandomDelay(10, 30) });

      // 엔터키 누르기 전 지연 시간 줄이기
      await page.waitForTimeout(getRandomDelay(100, 300));
      await page.keyboard.press("Enter");

      logger.info("검색 결과 페이지 로딩 완료를 기다리는 중...");

      // 페이지 로딩 완료 대기
      await page.waitForLoadState("networkidle", { timeout });

      // 검색 후 URL이 사람 확인 페이지로 리디렉션되었는지 확인
      const searchUrl = page.url();
      const isBlockedAfterSearch = sorryPatterns.some((pattern) =>
        searchUrl.includes(pattern)
      );

      if (isBlockedAfterSearch) {
        if (headless) {
          logger.warn("搜索后检测到人机验证页面，将以有头模式重新启动浏览器...");

          // 현재 페이지와 컨텍스트 닫기
          await page.close();
          await context.close();
          await browser.close();
          
          // 헤드 모드로 다시 실행
          return performSearchAndGetHtml(false);
        } else {
          logger.warn("搜索后检测到人机验证页面，请在浏览器中完成验证...");
          // 사용자가 확인을 완료하고 검색 페이지로 리디렉션될 때까지 대기
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => {
              const urlStr = url.toString();
              return sorryPatterns.every(
                (pattern) => !urlStr.includes(pattern)
              );
            },
          });
          logger.info("人机验证已完成，继续搜索...");

          // 페이지 다시 로딩 대기
          await page.waitForLoadState("networkidle", { timeout });
        }
      }

      // 현재 페이지 URL 가져오기
      const finalUrl = page.url();
      logger.info({ url: finalUrl }, "검색 결과 페이지가 로드되었습니다. HTML 추출 준비 중...");

      // 페이지가 완전히 로드되고 안정화되도록 추가 대기 시간
      logger.info("페이지 안정화를 기다리는 중...");
      await page.waitForTimeout(1000); // 1초 대기하여 페이지가 완전히 안정화되도록 함
      
      // 모든 비동기 작업이 완료되도록 네트워크 유휴 상태 다시 대기
      await page.waitForLoadState("networkidle", { timeout });
      
      // 페이지 HTML 내용 가져오기
      const fullHtml = await page.content();
      
      // CSS와 JavaScript 내용 제거, 순수 HTML만 유지
      // 모든 <style> 태그와 그 내용 제거
      let html = fullHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      // 모든 <link rel="stylesheet"> 태그 제거
      html = html.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
      // 모든 <script> 태그와 그 내용 제거
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      
      logger.info({
        originalLength: fullHtml.length,
        cleanedLength: html.length
      }, "페이지 HTML 내용을 성공적으로 가져오고 정리했습니다");

      // 필요한 경우 HTML을 파일로 저장하고 스크린샷 촬영
      let savedFilePath: string | undefined = undefined;
      let screenshotPath: string | undefined = undefined;
      
      if (saveToFile) {
        // 기본 파일명 생성 (제공되지 않은 경우)
        if (!outputPath) {
          // 디렉토리 존재 확인
          const outputDir = "./google-search-html";
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          
          // 파일명 생성: 쿼리어-타임스탬프.html
          const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
          const sanitizedQuery = query.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
          outputPath = `${outputDir}/${sanitizedQuery}-${timestamp}.html`;
        }

        // 파일 디렉토리 존재 확인
        const fileDir = path.dirname(outputPath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }

        // HTML 파일에 쓰기
        fs.writeFileSync(outputPath, html, "utf8");
        savedFilePath = outputPath;
        logger.info({ path: outputPath }, "정리된 HTML 내용이 파일로 저장되었습니다");
        
        // 웹페이지 스크린샷 저장
        // 스크린샷 파일명 생성 (HTML 파일명 기반, 확장자는 .png)
        const screenshotFilePath = outputPath.replace(/\.html$/, '.png');
        
        // 전체 페이지 스크린샷 촬영
        logger.info("웹페이지 스크린샷을 캡처하는 중...");
        await page.screenshot({
          path: screenshotFilePath,
          fullPage: true
        });
        
        screenshotPath = screenshotFilePath;
        logger.info({ path: screenshotFilePath }, "웹페이지 스크린샷이 저장되었습니다");
      }

      try {
        // 브라우저 상태 저장 (사용자가 저장하지 않도록 지정하지 않은 경우)
        if (!noSaveState) {
          logger.info({ stateFile }, "正在保存浏览器状态...");

          // 디렉토리 존재 확인
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }

          // 상태 저장
          await context.storageState({ path: stateFile });
          logger.info("브라우저 상태 저장 성공!");

          // 지문 설정 저장
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8"
            );
            logger.info({ fingerprintFile }, "지문 설정이 저장되었습니다");
          } catch (fingerprintError) {
            logger.error({ error: fingerprintError }, "지문 설정 저장 중 오류 발생");
          }
        } else {
          logger.info("사용자 설정에 따라 브라우저 상태를 저장하지 않습니다");
        }
      } catch (error) {
        logger.error({ error }, "保存浏览器状态时发生错误");
      }

      // 브라우저 닫기
      logger.info("正在关闭浏览器...");
      await browser.close();

      // HTML 응답 반환
      return {
        query,
        html,
        url: finalUrl,
        savedPath: savedFilePath,
        screenshotPath: screenshotPath,
        originalHtmlLength: fullHtml.length
      };
    } catch (error) {
      logger.error({ error }, "페이지 HTML 가져오기 과정에서 오류 발생");

      try {
        // 오류가 발생해도 브라우저 상태 저장 시도
        if (!noSaveState) {
          logger.info({ stateFile }, "正在保存浏览器状态...");
          const stateDir = path.dirname(stateFile);
          if (!fs.existsSync(stateDir)) {
            fs.mkdirSync(stateDir, { recursive: true });
          }
          await context.storageState({ path: stateFile });

          // 지문 설정 저장
          try {
            fs.writeFileSync(
              fingerprintFile,
              JSON.stringify(savedState, null, 2),
              "utf8"
            );
            logger.info({ fingerprintFile }, "지문 설정이 저장되었습니다");
          } catch (fingerprintError) {
            logger.error({ error: fingerprintError }, "지문 설정 저장 중 오류 발생");
          }
        }
      } catch (stateError) {
        logger.error({ error: stateError }, "保存浏览器状态时发生错误");
      }

      // 브라우저 닫기
      logger.info("正在关闭浏览器...");
      await browser.close();

      // 오류 정보 반환
      throw new Error(`Google 검색 페이지 HTML 가져오기 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 먼저 헤드리스 모드로 실행 시도
  return performSearchAndGetHtml(useHeadless);
}
