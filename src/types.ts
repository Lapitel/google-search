/**
 * 검색 결과 인터페이스
 */
export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

/**
 * 검색 응답 인터페이스
 */
export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

/**
 * 명령줄 옵션 인터페이스
 */
export interface CommandOptions {
  limit?: number;
  timeout?: number;
  headless?: boolean; // 더 이상 사용되지 않지만 기존 코드와의 호환성을 위해 유지
  stateFile?: string;
  noSaveState?: boolean;
  locale?: string; // 검색 결과 언어, 기본값은 한국어(ko-KR)
}

/**
 * HTML 응답 인터페이스 - 원본 검색 페이지 HTML을 가져오는 데 사용
 */
export interface HtmlResponse {
  query: string;    // 검색 쿼리
  html: string;     // 페이지 HTML 내용 (정리됨, CSS 및 JavaScript 제외)
  url: string;      // 검색 결과 페이지 URL
  savedPath?: string; // 선택사항, HTML이 파일로 저장된 경우 저장 경로
  screenshotPath?: string; // 선택사항, 웹페이지 스크린샷 저장 경로
  originalHtmlLength?: number; // 원본 HTML 길이 (CSS 및 JavaScript 포함)
}
