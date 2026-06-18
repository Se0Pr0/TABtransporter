# TABtransporter

PDF나 이미지 악보를 넣고, 기타와 베이스 기타용 TAB 운지를 다시 잡는 데스크톱 앱입니다.

## 한 줄로 말하면

악보를 넣으면 조옮김하고, 기타나 베이스에서 실제로 칠 수 있는 줄과 프렛을 추천해주는 도구입니다.

## 왜 필요한가

일반 악보는 음만 옮기면 됩니다.

하지만 기타 TAB은 다릅니다. 같은 음도 여러 줄과 여러 프렛에서 칠 수 있습니다.

예를 들어 같은 음이라도 이런 식으로 여러 위치가 나올 수 있습니다.

```text
1번줄 0프렛
2번줄 5프렛
3번줄 9프렛
```

그래서 TAB은 조옮김 후에 “진짜 치기 좋은 위치”를 다시 골라야 합니다.

## 현재 앱에서 되는 것

- Windows 데스크톱 앱 실행
- PDF 또는 이미지 악보 열기
- 원본 악보 미리보기
- 기타 6현, 베이스 4현 선택
- 반음 단위 조옮김
- 카포 값 반영
- 자동 TAB 운지 추천
- 간단 재생
- PDF 저장
- PNG 저장

## 중요한 점

PDF와 이미지는 악보 데이터가 아니라 그림입니다.

그래서 앱은 먼저 OMR 변환을 해야 합니다.

OMR은 쉽게 말해 “악보 OCR”입니다.

현재는 로컬 Audiveris 변환기를 찾습니다.

Audiveris가 없으면 앱은 변환된 척하지 않습니다.

Audiveris를 설치해야 실제 PDF/이미지 악보를 MusicXML로 분석하고, 그 결과를 조옮김/TAB 변환할 수 있습니다.

## 처음 설치할 것

### exe로 받은 사람

1. TABtransporter를 실행합니다.
2. 왼쪽 `OMR 변환기`에서 `Audiveris 설치`를 누릅니다.
3. Windows 설치 창이 뜨면 설치를 끝냅니다.
4. 앱을 다시 열거나 PDF/이미지를 다시 엽니다.

### GitHub에서 clone 받은 사람

처음 한 번만 실행합니다.

```powershell
npm install
npm run setup:audiveris
```

그 다음 앱을 실행합니다.

```powershell
npm run dev
```

### Audiveris 설치 기준

- 공식 GitHub Releases에서 최신 `windowsConsole-x86_64.msi`를 받습니다.
- `audiveris.com`은 공식 사이트가 아닙니다. 쓰지 않습니다.
- 설치 후 `AUDIVERIS_BIN` 사용자 환경 변수를 자동으로 잡습니다.
- 앱은 `AUDIVERIS_BIN`, PATH, Program Files 기본 위치를 순서대로 찾습니다.

## 실행 방법

개발용 실행:

```powershell
npm install
npm run setup:audiveris
npm run dev
```

빌드:

```powershell
npm run build
```

Windows 설치 파일 만들기:

```powershell
npm run package:win
```

빌드가 끝나면 실행 파일은 보통 여기에 생깁니다.

```text
release/win-unpacked/TABtransporter.exe
```

설치 파일은 보통 여기에 생깁니다.

```text
release/TABtransporter Setup 0.1.0.exe
```

## 사용 방법

1. 앱을 엽니다.
2. `PDF/이미지 열기`를 누릅니다.
3. 악보 PDF 또는 이미지 파일을 고릅니다.
   - 분석 중에는 화면이 흐려지고 진행률이 표시됩니다.
   - 이 동안 다른 버튼은 눌리지 않습니다.
4. 왼쪽에서 악기를 고릅니다.
   - 6현 기타
   - 4현 베이스
5. 오른쪽에서 조옮김 간격을 고릅니다.
6. 카포가 있으면 카포 숫자를 넣습니다.
7. `변환하기`를 누릅니다.
8. 가운데 `변환된 악보/TAB`에서 일반 음표와 추천 운지를 확인합니다.
9. `재생`을 눌러 소리를 확인합니다.
10. 결과가 괜찮으면 `PDF 저장` 또는 `PNG 저장`을 누릅니다.

## 화면 구조

- 왼쪽: 파일 정보, 악기 선택
- 가운데 왼쪽: 원본 PDF/이미지
- 가운데 오른쪽: 변환된 일반 악보와 TAB
- 오른쪽: 조옮김, 카포, 변환 상태, 내보내기
- 아래: 재생, 정지, 현재 상태

## Audiveris 연결

Audiveris를 설치한 경우 앱이 다음 위치를 자동으로 찾습니다.

```text
C:\Program Files\Audiveris\bin\Audiveris.bat
C:\Program Files\Audiveris\Audiveris.exe
C:\Program Files\Audiveris\Audiveris.bat
C:\Program Files (x86)\Audiveris\bin\Audiveris.bat
C:\Program Files (x86)\Audiveris\Audiveris.exe
C:\Program Files (x86)\Audiveris\Audiveris.bat
```

다른 위치에 있다면 `AUDIVERIS_BIN` 환경 변수에 실행 파일 경로를 넣으면 됩니다.

예:

```powershell
$env:AUDIVERIS_BIN="C:\path\to\Audiveris.bat"
```

설치 스크립트만 다시 돌리고 싶으면:

```powershell
npm run setup:audiveris
```

## 로그 확인

앱은 실행할 때마다 로그를 남깁니다.

기본 위치:

```text
%AppData%\TABtransporter\logs
```

앱 오른쪽 `로그` 패널에서 `로그 폴더 열기`를 누르면 바로 열 수 있습니다.

PDF/이미지 변환이 실패하면 `확인할 것` 패널에 다음이 표시됩니다.

- Audiveris 로그 파일 경로
- 실패 원인 요약
- 중요한 WARN/Exception 줄

예를 들어 Audiveris가 박자표나 마디 길이를 확정하지 못하면 MusicXML export가 실패하고, 이 경우 `변환하기` 버튼은 비활성화됩니다.

## 개발자가 확인할 것

타입 체크:

```bash
npm run typecheck
```

테스트:

```bash
npm test
```

패키징:

```bash
npm run package:win
```

## 핵심 직관

음은 하나여도 기타와 베이스에서는 칠 수 있는 위치가 여러 개입니다.

TABtransporter는 그 후보를 만들고, 사람이 마지막으로 확인하기 쉽게 보여주는 도구입니다.
