# Offline Mode in Lamina Mobile App

## Overview
The Lamina mobile app now supports an offline mode, allowing users to continue interacting with the app without internet connectivity. Actions taken while offline will be queued and synchronized when the application goes back online.

## Key Features
- **Action Queue**: User actions taken while offline are stored in a queue.
- **Data Storage**: Utilizes AsyncStorage for local data persistence.
- **Notifications**: Users are notified of their online status and any queued actions.

## Installation of AsyncStorage
You must install the `@react-native-async-storage/async-storage` library to use this feature:
```bash
npm install @react-native-async-storage/async-storage
# For iOS, run this in the ios directory
cd ios && pod install
```

## Using the Offline Mode
### SyncManager Class
The `SyncManager` class serves to manage the queue of actions and check the connectivity status:
```javascript
const syncManager = new SyncManager();
```

### Queueing Actions
Whenever an action is performed, use the `queueAction` method:
```javascript
syncManager.queueAction({ type: 'ADD_TODO', payload: { text: 'Buy groceries' } });
```

### Handling Connectivity
The app automatically detects online and offline status changes. When going online, it processes all queued actions:
```javascript
handleOnline() {
    console.log('Application is back online.');
    this.processQueue();
}
```

### Notifications
Notifications inform users when they are offline or when actions are successfully sent or fail to send:
```javascript
this.notifyUser('You are currently offline. Actions will be queued.');
```

## Testing
Testing of the offline functionality can be done using:
```bash
npm run test
```
All tests should pass indicating that offline capabilities are working correctly.

## Conclusion
The offline mode enhances user experience by allowing continued interaction without disruption. Ensure to handle actions carefully during transitions between online and offline modes, and verify proper functionality through testing.
