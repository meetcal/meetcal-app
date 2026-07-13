
# No args auto runs CLI list of options
default: choose

# Interactively choose which project task to execute right now
choose:
    @just --choose

# Push and submit to Apple
deploy-ios:
    EXPO_NO_CAPABILITY_SYNC=1 eas build --platform ios --profile production && eas submit --platform ios

# Push and submit to Google
deploy-android:
    eas build --platform android --profile production && eas submit --platform android

# Push update via EAS updates to prod
update-prod:
    bunx eas update --branch production --message "Production update"

# Push update via EAS updates to prod
update-preview:
    bunx eas update --branch preview --message "Production update"

# Push update via EAS updates to prod
update-dev:
    bunx eas update --branch development --message "Production update"

# Security and React scan
scan:
    bunx rnsec scan
    bunx react-doctor
