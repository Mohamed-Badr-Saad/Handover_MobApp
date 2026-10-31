/* Plant Handover (mobile) - connection settings.
   Only the project URL and the PUBLISHABLE key belong here: both are meant to
   be public. Never put the database password or a secret/service key here. */
window.HANDOVER_CONFIG = {
  supabaseUrl: "https://shqyrcdquakkavucahxl.supabase.co",
  supabaseKey: "sb_publishable_m_LTcdckErOdxIM89BN9wA_tHU8ZUAg",
  // Logins are private addresses "staff-<staff id>@<loginDomain>". No mail is
  // ever sent to them ("Confirm email" is switched off in Supabase).
  loginDomain: "plant-handover.app",
  // Largest side of a photo after it is shrunk on the phone, in pixels.
  photoMaxSide: 1600
};
