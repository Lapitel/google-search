import { pino } from "pino";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// 시스템 임시 디렉토리 사용, 크로스 플랫폼 호환성 보장
const logDir = path.join(os.tmpdir(), "google-search-logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 로그 파일 경로 생성
const logFilePath = path.join(logDir, "google-search.log");

// pino 로그 인스턴스 생성
const logger = pino({
  level: process.env.LOG_LEVEL || "info", // 환경 변수를 통해 로그 레벨 설정 가능
  transport: {
    targets: [
      // 콘솔에 출력, pino-pretty를 사용하여 출력을 예쁘게 만듦
      {
        target: "pino-pretty",
        level: "info",
        options: {
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
      // 파일로 출력 - trace 레벨을 사용하여 모든 로그를 확실히 캡처
      {
        target: "pino/file",
        level: "trace", // 모든 로그를 캡처하기 위해 최저 레벨 사용
        options: { destination: logFilePath },
      },
    ],
  },
});

// 프로세스 종료 시 처리 추가
process.on("exit", () => {
  logger.info("프로세스 종료, 로그 닫기");
});

process.on("SIGINT", () => {
  logger.info("SIGINT 신호 수신, 로그 닫기");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM 신호 수신, 로그 닫기");
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "처리되지 않은 예외");
  process.exit(1);
});

export default logger;
