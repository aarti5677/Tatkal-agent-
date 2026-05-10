// IRCTC Tatkal Assistant - compliant shared configuration.
// Safe constants only: timings, selectors, UI labels, and guardrails.
const TATKAL_CONFIG = {
  VERSION: "5.0.0-compliant-ui",

  IRCTC_BASE: "https://www.irctc.co.in",
  IRCTC_MAIN: "https://www.irctc.co.in/nget/train-search",

  TATKAL_AC_HOUR: 10,
  TATKAL_AC_MINUTE: 0,
  TATKAL_NON_AC_HOUR: 11,
  TATKAL_NON_AC_MINUTE: 0,

  AC_CLASSES: ["1A", "2A", "3A", "CC", "EC"],
  NON_AC_CLASSES: ["SL", "2S"],

  PRELOAD_LEAD_MS: 120000,
  MIN_ACTION_DELAY_MS: 10,
  MAX_ACTION_DELAY_MS: 60,
  ELEMENT_WAIT_MS: 15000,
  PAGE_WAIT_MS: 25000,
  LOGIN_WAIT_MS: 180000,
  OTP_TIMEOUT_MS: 120000,
  CAPTCHA_TIMEOUT_MS: 90000,
  CAPTCHA_AUTO_SOLVE: false,
  CAPTCHA_API_KEY: "",
  PAYMENT_WATCH_MS: 600000,

  READ_ONLY_PREFETCH: {
    ENABLED_BY_DEFAULT: false,
    BLOCKED_PATH_PARTS: [
      "book",
      "booking",
      "confirm",
      "payment",
      "pay",
      "captcha",
      "otp",
      "token",
      "save"
    ]
  },

  CLASS_LABELS: {
    "1A": "First AC",
    "2A": "Second AC",
    "3A": "Third AC",
    "CC": "AC Chair Car",
    "EC": "Executive Chair Car",
    "SL": "Sleeper",
    "2S": "Second Sitting"
  },

  QUOTA_LABELS: {
    TQ: "Tatkal",
    PT: "Premium Tatkal",
    GN: "General",
    LD: "Ladies",
    LB: "Lower Berth",
    HP: "Person with Disability"
  },

  SELECTORS: {
    login: {
      open: [
        "a.search_btn.loginText",
        "button.loginText",
        "a[aria-label*='Login' i]",
        "button[aria-label*='Login' i]",
        "a[href*='login']"
      ],
      user: [
        "input[formcontrolname='userid']",
        "input[formcontrolname='userId']",
        "input[name='userId']",
        "input[name='userid']",
        "input[placeholder*='User' i]",
        "input[autocomplete='username']"
      ],
      pass: [
        "input[formcontrolname='password']",
        "input[name='password']",
        "input[type='password']",
        "input[placeholder*='Password' i]"
      ],
      submit: [
        "button[type='submit']",
        "button.search_btn",
        "button.btn-primary",
        "button"
      ],
      logoutSignal: [
        "a[routerlink*='logout']",
        "a[href*='logout']",
        "button[aria-label*='Logout' i]",
        ".logout",
        ".userName",
        ".h_menu_drop_button"
      ]
    },

    search: {
      from: [
        "p-autocomplete[formcontrolname='origin'] input",
        "input[formcontrolname='origin']",
        "input[formcontrolname='fromStation']",
        "input[placeholder*='From' i]",
        "input[aria-label*='From' i]"
      ],
      to: [
        "p-autocomplete[formcontrolname='destination'] input",
        "input[formcontrolname='destination']",
        "input[formcontrolname='toStation']",
        "input[placeholder*='To' i]",
        "input[aria-label*='To' i]"
      ],
      date: [
        "p-calendar[formcontrolname='journeyDate'] input",
        "input[formcontrolname='journeyDate']",
        "input[placeholder*='Journey Date' i]",
        "input[placeholder*='Date' i]",
        "input[aria-label*='Date' i]"
      ],
      class: [
        "p-dropdown[formcontrolname='journeyClass']",
        "select[formcontrolname='journeyClass']",
        "input[formcontrolname='journeyClass']",
        "[aria-label*='Class' i]",
        ".journey-class"
      ],
      quota: [
        "p-dropdown[formcontrolname='quota']",
        "select[formcontrolname='quota']",
        "input[formcontrolname='quota']",
        "[aria-label*='Quota' i]",
        ".quota"
      ],
      submit: [
        "button.search_btn",
        "button[type='submit']",
        "button.btn-primary",
        "button"
      ]
    },

    overlays: {
      option: [
        "li[role='option']",
        "[role='option']",
        ".p-dropdown-item",
        ".p-autocomplete-item",
        ".ui-dropdown-item",
        ".ui-autocomplete-list-item",
        ".mat-option",
        ".ng-option",
        ".dropdown-item"
      ],
      dialogButton: [
        ".ui-dialog button",
        ".p-dialog button",
        ".modal button",
        "[role='dialog'] button"
      ]
    },

    results: {
      rows: [
        "app-train-avl-enq",
        "app-train-list",
        "app-train-avl",
        ".train-heading",
        ".train-avl-enq",
        ".form-group.no-pad",
        "tr"
      ],
      actionButton: [
        "button",
        "a",
        "[role='button']"
      ]
    },

    passenger: {
      root: [
        "app-psgn-details",
        "app-booking-details",
        "app-passenger-detail",
        "app-new-booking",
        ".passenger-dtl",
        ".psgn-details"
      ],
      add: [
        "button",
        "a",
        "[role='button']"
      ],
      name: [
        "input[formcontrolname='passengerName']",
        "input[name*='passengerName' i]",
        "input[placeholder*='Passenger Name' i]",
        "input[placeholder*='Name' i]"
      ],
      age: [
        "input[formcontrolname='passengerAge']",
        "input[name*='passengerAge' i]",
        "input[placeholder*='Age' i]",
        "input[type='number']"
      ],
      gender: [
        "p-dropdown[formcontrolname='passengerGender']",
        "select[formcontrolname='passengerGender']",
        "input[formcontrolname='passengerGender']",
        "[aria-label*='Gender' i]"
      ],
      berth: [
        "p-dropdown[formcontrolname='passengerBerthChoice']",
        "select[formcontrolname='passengerBerthChoice']",
        "input[formcontrolname='passengerBerthChoice']",
        "[aria-label*='Berth' i]"
      ],
      nationality: [
        "p-dropdown[formcontrolname='passengerNationality']",
        "select[formcontrolname='passengerNationality']",
        "input[formcontrolname='passengerNationality']",
        "[aria-label*='Nationality' i]"
      ],
      mobile: [
        "input[formcontrolname='mobileNumber']",
        "input[formcontrolname='mobileNo']",
        "input[placeholder*='Mobile' i]",
        "input[type='tel']"
      ],
      email: [
        "input[formcontrolname='email']",
        "input[placeholder*='Email' i]",
        "input[type='email']"
      ],
      continue: [
        "button",
        "a",
        "[role='button']"
      ]
    },

    captcha: {
      image: [
        "app-captcha img",
        "img[src*='captcha' i]",
        "img[alt*='captcha' i]",
        "img[alt*='verification' i]"
      ],
      input: [
        "input[formcontrolname='captcha']",
        "input[name*='captcha' i]",
        "input[placeholder*='captcha' i]",
        "input[aria-label*='captcha' i]"
      ]
    },

    otp: {
      input: [
        "input[formcontrolname*='otp' i]",
        "input[name*='otp' i]",
        "input[placeholder*='otp' i]",
        "input[autocomplete='one-time-code']"
      ],
      submit: [
        "button[type='submit']",
        "button",
        "[role='button']"
      ]
    },

    payment: {
      container: [
        "app-payment",
        "app-payment-options",
        ".payment",
        ".bank-type",
        ".payment-options"
      ],
      option: [
        "button",
        "a",
        "label",
        "[role='button']",
        "[role='radio']",
        ".bank-type",
        ".paymentOption"
      ],
      pay: [
        "button",
        "a",
        "[role='button']"
      ]
    }
  }
};

if (typeof self !== "undefined") self.TATKAL_CONFIG = TATKAL_CONFIG;
if (typeof window !== "undefined") window.TATKAL_CONFIG = TATKAL_CONFIG;
