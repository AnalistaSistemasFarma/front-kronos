# Access Control Implementation for Request Viewing System

## Overview

This document describes the implementation of username-based access control for the requests viewing system, which restricts editing capabilities to assigned users and administrators.

## Implementation Details

### 1. Database Structure Analysis

- `requests_general` table stores the main request data
- `process_category` table has an `assigned` field that references user IDs
- The relationship is: `requests_general.id_process_category` → `process_category.id` → `process_category.assigned` → `user.id`

### 2. API Modifications

#### View Request API (`app/api/requests-general/view-request/route.js`)

- Modified to include assigned user information by joining with `process_category` and `user` tables
- Added fields: `assignedUserId`, `assignedUserName`, `id_process_category`, `subject`

#### Update Request API (`app/api/requests-general/update-request/route.js`)

- Added server-side permission verification before allowing updates
- Implemented `verifyEditPermission()` function to check:
  - If user has admin role ('admin' or 'super_user')
  - If user is assigned to the request through process_category
- Returns appropriate error messages for unauthorized access attempts

#### Permission Verification API (`app/api/requests-general/verify-permissions/route.js`)

- Created dedicated endpoint for permission verification
- Supports both POST (for specific request verification) and GET (for user role information)
- Provides detailed permission information including reason for access/denial

### 3. Access Control Utility (`lib/access-control.ts`)

- Created reusable utility functions for checking admin privileges
- Supports both role-based and subprocess-based admin verification
- Includes client-side helper function for UI checks

### 4. Frontend Implementation (`app/process/request-general/view-request/page.tsx`)

#### State Management

- Added `canEdit`, `isAdmin`, `loadingPermissions` state variables
- Extended `Request` interface to include assigned user information

#### Permission Logic

- Implemented `checkEditPermissions()` function that:
  - Checks if user has admin role
  - Compares current username with assigned username
  - Sets appropriate edit permissions

#### UI Controls

- Disabled edit button when user lacks permissions
- Disabled all form inputs during edit mode for unauthorized users
- Hidden resolution form for users without edit permissions
- Disabled file upload component for unauthorized users
- Added access denied alert message

#### User Experience

- Shows loading state while checking permissions
- Provides clear feedback when access is denied
- Maintains read-only access for all authenticated users

## Security Features

### Client-Side

- Immediate UI feedback based on permissions
- Prevents unauthorized edit attempts at the interface level

### Server-Side

- Double verification for all critical operations
- Detailed audit logging for permission checks
- Proper error responses for unauthorized access

## Testing Instructions

### Test Scenarios

1. **Admin User Access**

   - Login as admin user
   - Navigate to any request
   - Verify edit button is enabled
   - Test editing and saving changes

2. **Assigned User Access**

   - Login as regular user
   - Navigate to a request assigned to this user
   - Verify edit button is enabled
   - Test editing and saving changes

3. **Unassigned User Access**

   - Login as regular user
   - Navigate to a request NOT assigned to this user
   - Verify edit button is disabled
   - Verify access denied alert is shown
   - Verify all form inputs are disabled

4. **Cross-User Assignment Testing**

   - Create a request assigned to User A
   - Login as User B (not admin)
   - Verify no edit access
   - Login as User A
   - Verify edit access works

5. **Permission Verification API Testing**
   - Test POST endpoint with various user/request combinations
   - Verify proper response codes and messages
   - Test GET endpoint for user role information

### Expected Behaviors

- **Admin Users**: Can edit any request regardless of assignment
- **Assigned Users**: Can only edit requests assigned to them
- **Unassigned Users**: Read-only access to all requests
- **Unauthenticated Users**: Redirected to login

### Error Handling

- **401 Unauthorized**: Returned when no valid session
- **403 Forbidden**: Returned when user lacks edit permissions
- **404 Not Found**: Returned when request or user doesn't exist
- **500 Server Error**: Returned for unexpected server issues

## Security Considerations

1. **Defense in Depth**: Both client and server-side verification
2. **Principle of Least Privilege**: Users only get access they need
3. **Audit Trail**: All permission checks are logged
4. **Input Validation**: All parameters are validated before processing
5. **Error Handling**: Graceful failure with informative messages

## Future Enhancements

1. **Role-Based UI**: Different interfaces based on user roles
2. **Assignment History**: Track changes in user assignments
3. **Bulk Operations**: Admin tools for managing multiple requests
4. **Notification System**: Alert assigned users of request changes
5. **Permission Caching**: Improve performance with permission caching
