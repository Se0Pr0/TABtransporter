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
Audiveris가 없으면 실제 변환 대신 예제 악보를 보여주면서 화면 흐름을 확인할 수 있게 합니다.

## 실행 방법

개발용 실행:

```bash
npm install
npm run dev
```

빌드:

```bash
npm run build
```

Windows 설치 파일 만들기:

```bash
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
4. 왼쪽에서 악기를 고릅니다.
   - 6현 기타
   - 4현 베이스
5. 오른쪽에서 조옮김 간격을 고릅니다.
6. 카포가 있으면 카포 숫자를 넣습니다.
7. 가운데 `변환된 TAB`에서 추천 운지를 확인합니다.
8. `재생`을 눌러 소리를 확인합니다.
9. 결과가 괜찮으면 `PDF 저장` 또는 `PNG 저장`을 누릅니다.

## 화면 구조

- 왼쪽: 파일 정보, 악기 선택
- 가운데 왼쪽: 원본 PDF/이미지
- 가운데 오른쪽: 변환된 TAB
- 오른쪽: 조옮김, 카포, 변환 상태, 내보내기
- 아래: 재생, 정지, 현재 상태

## Audiveris 연결

Audiveris를 설치한 경우 앱이 다음 위치를 자동으로 찾습니다.

```text
C:\Program Files\Audiveris\bin\Audiveris.bat
C:\Program Files\Audiveris\Audiveris.exe
C:\Program Files (x86)\Audiveris\bin\Audiveris.bat
C:\Program Files (x86)\Audiveris\Audiveris.exe
```

다른 위치에 있다면 `AUDIVERIS_BIN` 환경 변수에 실행 파일 경로를 넣으면 됩니다.

예:

```powershell
$env:AUDIVERIS_BIN="C:\path\to\Audiveris.bat"
```

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
