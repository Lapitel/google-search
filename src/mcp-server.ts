#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { googleSearch, getGoogleSearchPageHtml } from "./search.js";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import logger from "./logger.js";
import { chromium, Browser } from "playwright";

// 전역 브라우저 인스턴스
let globalBrowser: Browser | undefined = undefined;

// MCP 서버 인스턴스 생성
const server = new McpServer({
  name: "google-search-server",
  version: "1.0.0",
});

// Google 검색 도구 등록
server.tool(
  "google-search",
  "Google 검색 엔진을 사용하여 실시간 네트워크 정보를 조회하고, 제목, 링크, 요약이 포함된 검색 결과를 반환합니다. 최신 정보를 얻거나, 특정 주제 자료를 찾거나, 현재 사건을 연구하거나, 사실을 검증하는 시나리오에 적합합니다. 결과는 JSON 형식으로 반환되며, 쿼리 내용과 일치하는 결과 목록을 포함합니다.",
  {
    query: z
      .string()
      .describe(
        "검색 쿼리 문자열. 최상의 결과를 위해: 1) 영어 키워드 검색을 우선 사용하세요. 영어 콘텐츠가 일반적으로 더 풍부하고 최신이며, 특히 기술 및 학술 분야에서 그렇습니다; 2) 모호한 구문보다는 구체적인 키워드를 사용하세요; 3) 따옴표 \"정확한 구문\"를 사용하여 강제 매칭할 수 있습니다; 4) site:도메인을 사용하여 특정 웹사이트를 제한하세요; 5) -를 사용하여 제외어를 필터링하세요; 6) OR을 사용하여 대안어를 연결하세요; 7) 전문 용어를 우선 사용하세요; 8) 균형 잡힌 결과를 위해 2-5개의 키워드로 제한하세요; 9) 대상 콘텐츠에 따라 적절한 언어를 선택하세요 (특정 중국어 리소스를 찾을 필요가 있을 때만 중국어 사용). 예: 'climate change report 2024 site:gov -opinion' 또는 '\"machine learning algorithms\" tutorial (Python OR Julia)'"
      ),
    limit: z
      .number()
      .optional()
      .describe("반환할 검색 결과 수 (기본값: 10, 권장 범위: 1-20)"),
    timeout: z
      .number()
      .optional()
      .describe("검색 작업의 타임아웃 시간(밀리초) (기본값: 30000, 네트워크 상태에 따라 조정 가능)"),
  },
  async (params) => {
    try {
      const { query, limit, timeout } = params;
      logger.info({ query }, "Google 검색 실행");

      // 사용자 홈 디렉토리 하위의 상태 파일 경로 가져오기
      const stateFilePath = path.join(
        os.homedir(),
        ".google-search-browser-state.json"
      );
      logger.info({ stateFilePath }, "상태 파일 경로 사용");

      // 상태 파일 존재 여부 확인
      const stateFileExists = fs.existsSync(stateFilePath);

      // 초기화 경고 메시지
      let warningMessage = "";

      if (!stateFileExists) {
        warningMessage =
          "⚠️ 주의: 브라우저 상태 파일이 존재하지 않습니다. 처음 사용할 때, 사람이 아닌지 확인(캡차)에 직면하면 시스템이 자동으로 헤드 모드로 전환하여 검증을 완료할 수 있도록 합니다. 완료 후 시스템이 상태 파일을 저장하므로, 이후 검색이 더 원활해집니다.";
        logger.warn(warningMessage);
      }

      // 전역 브라우저 인스턴스를 사용하여 검색 실행
      const results = await googleSearch(
        query,
        {
          limit: limit,
          timeout: timeout,
          stateFile: stateFilePath,
        },
        globalBrowser
      );

      // 경고 정보를 포함한 반환 결과 구성
      let responseText = JSON.stringify(results, null, 2);
      if (warningMessage) {
        responseText = warningMessage + "\n\n" + responseText;
      }

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    } catch (error) {
      logger.error({ error }, "검색 도구 실행 오류");

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `검색 실패: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  }
);

// 서버 시작
async function main() {
  try {
    logger.info("Google 검색 MCP 서버 시작 중...");

    // 전역 브라우저 인스턴스 초기화
    logger.info("전역 브라우저 인스턴스 초기화 중...");
    globalBrowser = await chromium.launch({
      headless: true,
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
    logger.info("전역 브라우저 인스턴스 초기화 성공");

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info("Google 검색 MCP 서버가 시작되었습니다. 연결을 기다리는 중...");

    // 프로세스 종료 시 정리 함수 설정
    process.on("exit", async () => {
      await cleanupBrowser();
    });

    // Ctrl+C 처리 (Windows 및 Unix/Linux)
    process.on("SIGINT", async () => {
      logger.info("SIGINT 신호를 받았습니다. 서버를 종료하는 중...");
      await cleanupBrowser();
      process.exit(0);
    });

    // 프로세스 종료 처리 (Unix/Linux)
    process.on("SIGTERM", async () => {
      logger.info("SIGTERM 신호를 받았습니다. 서버를 종료하는 중...");
      await cleanupBrowser();
      process.exit(0);
    });

    // Windows 특정 처리
    if (process.platform === "win32") {
      // Windows의 CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT 처리
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.on("SIGINT", async () => {
        logger.info("Windows: SIGINT 신호를 받았습니다. 서버를 종료하는 중...");
        await cleanupBrowser();
        process.exit(0);
      });
    }
  } catch (error) {
    logger.error({ error }, "서버 시작 실패");
    await cleanupBrowser();
    process.exit(1);
  }
}

// 브라우저 리소스 정리
async function cleanupBrowser() {
  if (globalBrowser) {
    logger.info("전역 브라우저 인스턴스를 종료하는 중...");
    try {
      await globalBrowser.close();
      globalBrowser = undefined;
      logger.info("전역 브라우저 인스턴스가 종료되었습니다");
    } catch (error) {
      logger.error({ error }, "브라우저 인스턴스 종료 중 오류 발생");
    }
  }
}

main();
