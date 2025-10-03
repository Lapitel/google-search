# Google Search Tool

Playwright 기반의 Node.js 도구로, 검색 엔진의 봇 차단 메커니즘을 우회해 Google 검색을 실행하고 결과를 추출합니다. 명령줄 도구로 바로 사용할 수도 있고, Claude와 같은 AI 어시스턴트에 실시간 검색 기능을 제공하는 Model Context Protocol(MCP) 서버로도 활용할 수 있습니다.

[중국어 문서](README.zh-CN.md)

## 주요 기능

- **로컬 SERP API 대안**: 유료 검색 엔진 결과 API 서비스에 의존하지 않고 모든 검색을 로컬에서 수행합니다
- **고급 봇 탐지 우회 기법**:
  - 실제 사용자 행동을 모사하는 지능형 브라우저 지문 관리
  - 검증 빈도를 줄이기 위한 브라우저 상태 자동 저장 및 복원
  - 검증이 필요할 때 자동으로 헤드 모드로 전환하는 스마트 헤드리스/헤드 모드 전환
  - 탐지 위험을 낮추기 위한 기기 및 로케일 설정 무작위화
- **원시 HTML 가져오기**: Google의 페이지 구조가 변경되었을 때 분석과 디버깅을 위해 검색 결과 페이지의 원시 HTML(CSS와 JavaScript 제거)을 가져올 수 있습니다
- **페이지 스크린샷**: HTML을 저장할 때 전체 페이지 스크린샷을 자동으로 캡처하고 저장합니다
- **MCP 서버 통합**: 추가 API 키 없이 Claude 등의 AI 어시스턴트에 실시간 검색 기능을 제공합니다
- **완전한 오픈 소스 및 무료**: 모든 코드는 오픈 소스이며 사용 제한이 없어 자유롭게 커스터마이즈하고 확장할 수 있습니다

## 기술적 특징

- TypeScript로 개발되어 타입 안정성과 우수한 개발 경험을 제공합니다
- Playwright 기반 브라우저 자동화로 여러 브라우저 엔진을 지원합니다
- 검색 키워드를 위한 명령줄 매개변수를 지원합니다
- AI 어시스턴트 통합을 위한 MCP 서버를 제공합니다
- 제목, 링크, 스니펫이 포함된 검색 결과를 반환합니다
- 분석을 위해 검색 결과 페이지의 원시 HTML을 가져올 수 있는 옵션을 제공합니다
- 결과를 JSON 형식으로 출력합니다
- 디버깅을 위한 헤드리스/헤드 모드를 모두 지원합니다
- 상세한 로그를 출력합니다
- 견고한 오류 처리 로직을 갖추고 있습니다
- 봇 탐지를 효과적으로 피하기 위한 브라우저 상태 저장 및 복원 기능이 있습니다

## 설치

```bash
# Install from source
git clone https://github.com/web-agent-master/google-search.git
cd google-search
# Install dependencies
npm install
# Or using yarn
yarn
# Or using pnpm
pnpm install

# Compile TypeScript code
npm run build
# Or using yarn
yarn build
# Or using pnpm
pnpm build

# Link package globally (required for MCP functionality)
npm link
# Or using yarn
yarn link
# Or using pnpm
pnpm link
```

### Windows 환경 참고 사항

이 도구는 Windows 환경에서도 잘 동작하도록 별도로 조정되었습니다.

1. Windows 명령 프롬프트와 PowerShell에서 명령줄 도구가 제대로 동작하도록 `.cmd` 파일을 제공합니다
2. 로그 파일은 Unix/Linux의 `/tmp` 대신 시스템 임시 디렉터리에 저장됩니다
3. 서버가 정상적으로 종료되도록 Windows 전용 프로세스 신호 처리를 추가했습니다
4. Windows 경로 구분자를 지원하기 위해 크로스플랫폼 경로 처리를 사용합니다

## 사용법

### 명령줄 도구

```bash
# Direct command line usage
google-search "search keywords"

# Using command line options
google-search --limit 5 --timeout 60000 --no-headless "search keywords"

# Or using npx
npx google-search-cli "search keywords"

# Run in development mode
pnpm dev "search keywords"

# Run in debug mode (showing browser interface)
pnpm debug "search keywords"

# Get raw HTML of search result page
google-search "search keywords" --get-html

# Get HTML and save to file
google-search "search keywords" --get-html --save-html

# Get HTML and save to specific file
google-search "search keywords" --get-html --save-html --html-output "./output.html"
```

#### 명령줄 옵션

- `-l, --limit <number>`: 결과 개수 제한 (기본값: 10)
- `-t, --timeout <number>`: 타임아웃(밀리초) (기본값: 60000)
- `--no-headless`: 브라우저 화면을 표시합니다(디버깅용)
- `--remote-debugging-port <number>`: 원격 디버깅 포트를 활성화합니다 (기본값: 9222)
- `--state-file <path>`: 브라우저 상태 파일 경로 (기본값: ./browser-state.json)
- `--no-save-state`: 브라우저 상태를 저장하지 않습니다
- `--get-html`: 검색 결과를 파싱하는 대신 원시 HTML을 가져옵니다
- `--save-html`: HTML을 파일로 저장합니다(`--get-html`과 함께 사용)
- `--html-output <path>`: HTML 출력 파일 경로를 지정합니다(`--get-html`, `--save-html`과 함께 사용)
- `-V, --version`: 버전 정보를 표시합니다
- `-h, --help`: 도움말을 표시합니다

#### 출력 예시

```json
{
  "query": "deepseek",
  "results": [
    {
      "title": "DeepSeek",
      "link": "https://www.deepseek.com/",
      "snippet": "DeepSeek-R1 is now live and open source, rivaling OpenAI's Model o1. Available on web, app, and API. Click for details. Into ..."
    },
    {
      "title": "DeepSeek",
      "link": "https://www.deepseek.com/",
      "snippet": "DeepSeek-R1 is now live and open source, rivaling OpenAI's Model o1. Available on web, app, and API. Click for details. Into ..."
    },
    {
      "title": "deepseek-ai/DeepSeek-V3",
      "link": "https://github.com/deepseek-ai/DeepSeek-V3",
      "snippet": "We present DeepSeek-V3, a strong Mixture-of-Experts (MoE) language model with 671B total parameters with 37B activated for each token."
    }
    // 추가 결과...
  ]
}
```

#### HTML 출력 예시

`--get-html` 옵션을 사용하면 HTML 콘텐츠에 대한 정보가 포함됩니다.

```json
{
  "query": "playwright automation",
  "url": "https://www.google.com/",
  "originalHtmlLength": 1291733,
  "cleanedHtmlLength": 456789,
  "htmlPreview": "<!DOCTYPE html><html itemscope=\"\" itemtype=\"http://schema.org/SearchResultsPage\" lang=\"zh-CN\"><head><meta charset=\"UTF-8\"><meta content=\"dark light\" name=\"color-scheme\"><meta content=\"origin\" name=\"referrer\">..."
}
```

`--save-html` 옵션을 함께 사용하면 HTML이 저장된 경로 정보가 추가됩니다.

```json
{
  "query": "playwright automation",
  "url": "https://www.google.com/",
  "originalHtmlLength": 1292241,
  "cleanedHtmlLength": 458976,
  "savedPath": "./google-search-html/playwright_automation-2025-04-06T03-30-06-852Z.html",
  "screenshotPath": "./google-search-html/playwright_automation-2025-04-06T03-30-06-852Z.png",
  "htmlPreview": "<!DOCTYPE html><html itemscope=\"\" itemtype=\"http://schema.org/SearchResultsPage\" lang=\"zh-CN\">..."
}
```

### MCP 서버

이 프로젝트는 Model Context Protocol(MCP) 서버 기능을 제공하여 Claude와 같은 AI 어시스턴트가 Google 검색 기능을 직접 사용할 수 있게 합니다. MCP는 AI 어시스턴트가 외부 도구와 데이터를 안전하게 활용하도록 하는 개방형 프로토콜입니다.

```bash
# Build the project
pnpm build
```

#### Claude Desktop 연동

1. Claude Desktop 설정 파일을 수정합니다.
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
     - 일반적으로 `C:\Users\username\AppData\Roaming\Claude\claude_desktop_config.json`에 위치합니다
     - Windows 탐색기 주소창에 `%APPDATA%\Claude`를 입력하면 바로 이동할 수 있습니다

2. 서버 설정을 추가한 뒤 Claude를 재시작합니다.

```json
{
  "mcpServers": {
    "google-search": {
      "command": "npx",
      "args": ["google-search-mcp"]
    }
  }
}
```

Windows 환경에서는 다음과 같은 설정도 사용할 수 있습니다.

1. cmd.exe와 npx를 사용하는 방법:

```json
{
  "mcpServers": {
    "google-search": {
      "command": "cmd.exe",
      "args": ["/c", "npx", "google-search-mcp"]
    }
  }
}
```

2. node 실행 파일 경로를 직접 지정하는 방법(위 방법에 문제가 있을 때 권장):

```json
{
  "mcpServers": {
    "google-search": {
      "command": "node",
      "args": ["C:/path/to/your/google-search/dist/src/mcp-server.js"]
    }
  }
}
```

참고: 두 번째 방법을 사용할 경우 `C:/path/to/your/google-search`를 패키지를 설치한 실제 전체 경로로 바꿔야 합니다.

통합이 완료되면 "최신 AI 연구를 검색해 줘"와 같이 Claude에서 바로 검색 기능을 사용할 수 있습니다.

## 프로젝트 구조

```
google-search/
├── package.json          # 프로젝트 설정 및 의존성
├── tsconfig.json         # TypeScript 설정
├── src/
│   ├── index.ts          # 진입 파일(명령줄 파싱과 메인 로직)
│   ├── search.ts         # 검색 기능 구현(Playwright 브라우저 자동화)
│   ├── mcp-server.ts     # MCP 서버 구현
│   └── types.ts          # 타입 정의(인터페이스 및 타입 선언)
├── dist/                 # 컴파일된 JavaScript 파일
├── bin/                  # 실행 파일
│   └── google-search     # 명령줄 진입 스크립트
├── README.md             # 프로젝트 문서
└── .gitignore            # Git 무시 규칙
```

## 기술 스택

- **TypeScript**: 개발 언어로, 타입 안정성과 뛰어난 개발 경험을 제공합니다
- **Node.js**: JavaScript/TypeScript 코드를 실행하는 런타임 환경
- **Playwright**: 여러 브라우저를 지원하는 브라우저 자동화 도구
- **Commander**: 명령줄 인수를 파싱하고 도움말을 생성하는 라이브러리
- **Model Context Protocol (MCP)**: AI 어시스턴트 통합을 위한 개방형 프로토콜
- **MCP SDK**: MCP 서버 구현을 위한 개발 도구 모음
- **Zod**: 검증과 타입 안전성을 제공하는 스키마 정의 라이브러리
- **pnpm**: 디스크 공간과 설치 시간을 절약하는 효율적인 패키지 관리자

## 개발 가이드

다음 명령은 모두 프로젝트 루트 디렉터리에서 실행할 수 있습니다.

```bash
# Install dependencies
pnpm install

# Install Playwright browsers
pnpm run postinstall

# Compile TypeScript code
pnpm build

# Clean compiled output
pnpm clean
```

### CLI 개발

```bash
# Run in development mode
pnpm dev "search keywords"

# Run in debug mode (showing browser interface)
pnpm debug "search keywords"

# Run compiled code
pnpm start "search keywords"

# Test search functionality
pnpm test
```

### MCP 서버 개발

```bash
# Run MCP server in development mode
pnpm mcp

# Run compiled MCP server
pnpm mcp:build
```

## 오류 처리

이 도구에는 견고한 오류 처리 메커니즘이 내장되어 있습니다.

- 브라우저 시작에 실패하면 이해하기 쉬운 오류 메시지를 제공합니다
- 네트워크 연결 문제 발생 시 자동으로 오류 상태를 반환합니다
- 검색 결과 파싱에 실패하면 자세한 로그를 남깁니다
- 타임아웃 상황에서도 우아하게 종료하고 유용한 정보를 제공합니다

## 참고 사항

### 일반 참고 사항

- 이 도구는 학습 및 연구 목적에만 사용해야 합니다
- Google의 서비스 약관과 정책을 준수해 주세요
- 요청을 너무 자주 보내면 Google에서 차단될 수 있으니 주의하세요
- 일부 지역에서는 Google에 접속하기 위해 프록시가 필요할 수 있습니다
- Playwright는 브라우저 설치가 필요하며, 최초 사용 시 자동으로 다운로드됩니다

### 상태 파일

- 상태 파일에는 브라우저 쿠키와 저장소 데이터가 포함되어 있으니 안전하게 보관하세요
- 상태 파일을 사용하면 Google의 봇 탐지를 효과적으로 피할 수 있어 검색 성공률이 높아집니다

### MCP 서버

- MCP 서버를 사용하려면 Node.js v16 이상이 필요합니다
- MCP 서버 사용 시 Claude Desktop을 최신 버전으로 유지해 주세요
- Claude Desktop을 구성할 때 MCP 서버 파일 경로는 절대 경로로 지정해야 합니다

### Windows 전용 참고 사항

- Windows 환경에서는 최초로 Playwright 브라우저를 설치할 때 관리자 권한이 필요할 수 있습니다
- 권한 문제를 겪는다면 관리자 권한으로 명령 프롬프트나 PowerShell을 실행해 보세요
- Windows 방화벽이 Playwright 브라우저의 네트워크 연결을 차단할 수 있으니, 알림이 나타나면 접근을 허용하세요
- 브라우저 상태 파일은 기본적으로 사용자 홈 디렉터리에 `.google-search-browser-state.json` 이름으로 저장됩니다
- 로그 파일은 시스템 임시 디렉터리의 `google-search-logs` 폴더에 저장됩니다

## 상용 SERP API와의 비교

SerpAPI와 같은 유료 검색 엔진 결과 API 서비스와 비교했을 때 이 프로젝트는 다음과 같은 장점이 있습니다.

- **완전히 무료**: API 호출 비용이 없습니다
- **로컬 실행**: 모든 검색을 로컬에서 실행하며 제3자 서비스에 의존하지 않습니다
- **개인정보 보호**: 검색 쿼리가 제3자에 의해 기록되지 않습니다
- **커스터마이즈 가능성**: 완전한 오픈 소스로 필요에 따라 수정하고 확장할 수 있습니다
- **사용 제한 없음**: API 호출 횟수나 빈도 제한이 없습니다
- **MCP 통합**: Claude와 같은 AI 어시스턴트와의 통합을 기본 지원합니다

