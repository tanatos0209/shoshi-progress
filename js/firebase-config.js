/* Firebase web config shared by shoshi-progress and, later, shoshi-ox.
   Leave the strings empty to keep this PWA local-only.
   Paste the web app config from Firebase console → Project settings.
   The apiKey is not a secret (it ships in the page). Firestore rules
   in firestore.rules are what keep each user's data private.
   Do not put server keys, service-account JSON, or OAuth client secrets here. */
window.SHOSHI_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
