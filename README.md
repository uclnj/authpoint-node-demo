# authpoint-node-demo
Short node based demo of push authentication with **WatchGuard Authpoint**.

This is a short Authpoint proof of concept demo in node to demonstrate push notifications using the Authpoint API.

From the WatchGuard cloud control panel, go to administration > managed access and either enable or copy the values for **Access ID (Read-write)** and **API Key** into the environment file (.env) along with the password you created when you setup RESTful API Access.

From the configure > Authpoint > resources menu either add in RESTful API Access or copy the **Resource ID** and **Account ID** values into the environment file.

Once setup, start with _node authpoint-demo.js [username] [origin ip address]_

If you have a policy object with network locations, this is where _origin ip address_ comes into play.

After starting, node will request a bearer token.

Press F2 to initiate a push notification to the device you registered on the Authpoint users menu.
Press F3 to use a one-time password either from your WatchGuard app profile or key-fob token.
