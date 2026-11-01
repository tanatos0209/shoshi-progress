/* Firebase web config shared by shoshi-progress and, later, shoshi-ox.
   Production web app config for project shoshi-sync.
   The apiKey is not a secret (it ships in the page). Firestore rules
   in firestore.rules are what keep each user's data private.
   Do not put server keys, service-account JSON, or OAuth client secrets here. */
window.SHOSHI_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCbY4IcyZZRR3n35LtFNFXJFBM59Mkn33c",
  authDomain: "shoshi-sync.firebaseapp.com",
  projectId: "shoshi-sync",
  storageBucket: "shoshi-sync.firebasestorage.app",
  messagingSenderId: "894893414794",
  appId: "1:894893414794:web:69b767ae7d62817d5a5073"
};
