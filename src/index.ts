#!/usr/bin/env node

import { Command } from "commander";
import { googleSearch, getGoogleSearchPageHtml } from "./search.js";
import { CommandOptions } from "./types.js";

// 패키지 정보 가져오기
import packageJson from "../package.json" with { type: "json" };

// 명령줄 프로그램 생성
const program = new Command();

// 명령줄 옵션 구성
program
  .name("google-search")
  .description("Playwright 기반의 Google 검색 CLI 도구")
  .version(packageJson.version)
  .argument("<query>", "검색 키워드")
  .option("-l, --limit <number>", "결과 수 제한", parseInt, 10)
  .option("-t, --timeout <number>", "타임아웃 시간(밀리초)", parseInt, 30000)
  .option("--no-headless", "더 이상 사용되지 않음: 이제 항상 먼저 헤드리스 모드를 시도하고, 사람이 아닌지 확인(캡차)에 직면하면 자동으로 헤드 모드로 전환됩니다")
  .option("--state-file <path>", "브라우저 상태 파일 경로", "./browser-state.json")
  .option("--no-save-state", "브라우저 상태를 저장하지 않음")
  .option("--get-html", "파싱된 결과 대신 검색 결과 페이지의 원본 HTML 가져오기")
  .option("--save-html", "HTML을 파일로 저장")
  .option("--html-output <path>", "HTML 출력 파일 경로")
  .action(async (query: string, options: CommandOptions & { getHtml?: boolean, saveHtml?: boolean, htmlOutput?: string }) => {
    try {
      if (options.getHtml) {
        // HTML 가져오기
        const htmlResult = await getGoogleSearchPageHtml(
          query,
          options,
          options.saveHtml || false,
          options.htmlOutput
        );

        // HTML이 파일로 저장된 경우, 출력에 파일 경로 정보 포함
        if (options.saveHtml && htmlResult.savedPath) {
          console.log(`HTML이 파일로 저장되었습니다: ${htmlResult.savedPath}`);
        }

        // 결과 출력 (전체 HTML을 포함하지 않음, 콘솔 출력이 너무 많아지는 것을 방지)
        const outputResult = {
          query: htmlResult.query,
          url: htmlResult.url,
          originalHtmlLength: htmlResult.originalHtmlLength, // 원본 HTML 길이 (CSS 및 JavaScript 포함)
          cleanedHtmlLength: htmlResult.html.length, // 정리된 HTML 길이 (CSS 및 JavaScript 제외)
          savedPath: htmlResult.savedPath,
          screenshotPath: htmlResult.screenshotPath, // 웹페이지 스크린샷 저장 경로
          // 미리보기로 HTML의 처음 500자만 출력
          htmlPreview: htmlResult.html.substring(0, 500) + (htmlResult.html.length > 500 ? '...' : '')
        };
        
        console.log(JSON.stringify(outputResult, null, 2));
      } else {
        // 일반 검색 실행
        const results = await googleSearch(query, options);
        
        // 결과 출력
        console.log(JSON.stringify(results, null, 2));
      }
    } catch (error) {
      console.error("오류:", error);
      process.exit(1);
    }
  });

// 명령줄 인수 파싱
program.parse(process.argv);
