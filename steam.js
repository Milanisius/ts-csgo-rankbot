const logger = require('./logger')(__filename);
const xmldoc = require("xmldoc");
const rp = require('request-promise');
const steamApi = require("steam");
const csgo = require("csgo");
const fs = require('fs');
const config = require('./config/config');
const database = require("./database");
const BroadcastChannel = require('broadcast-channel');
const exchangeChannel = new BroadcastChannel('exchange');

module.exports.steamProfileUrl = null;



class Steam {

    /**
     * Constructor
     */
    constructor(){
        this.SteamClient = new steamApi.SteamClient();
        this.SteamUser = new steamApi.SteamUser(this.SteamClient);
        this.SteamGC = new steamApi.SteamGameCoordinator(this.SteamClient, 730);
        this.SteamFriends = new steamApi.SteamFriends(this.SteamClient);
        this.CSGOCli = new csgo.CSGOClient(this.SteamUser, this.SteamGC, true);
    }



    /**
     * Returns the
     * @param steam64id
     * @return rank id if set; else null
     */
    async getCSGORankOfSteam64id(steam64id){
        return new Promise((resolve => {
            logger.debug(`Getting player Profile of steam64id ${steam64id}`);

            //Register event listener for one time use
            this.CSGOCli.once('playerProfile', async (profile) => {
                let ranking = profile.account_profiles[0].ranking;
		console.log("Loggings from getCSGORankOFSTEAM64 id");
		console.log(profile);
		console.log(ranking);
                //We need to check if ranking is set; if not, the user has not added us to their friend list
                if(ranking !== null)
                {
                    logger.debug(`Got rank ${ranking.rank_id} for steam64id ${steam64id}`);
                    resolve(ranking.rank_id);
                }
                else
                {
                    resolve(null);
                }
            });
	    console.log("line 57");
	    console.log(steam64id);
	    console.log(this.CSGOCli.ToAccountID(steam64id));
            this.CSGOCli.playerProfileRequest(this.CSGOCli.ToAccountID(steam64id));
        }));
    }



    /**
     * Handles changes of relationship. Important when receiving friend requests from new users.
     * @param steam64id
     * @param relationshipStatus
     */
    async onRelationshipChange(steam64id, relationshipStatus) {
        logger.debug(`New relationship event from ${steam64id} (relationship=${relationshipStatus})`);

        //Null check
        if (steam64id === undefined || relationshipStatus === undefined) {
            return;
        }


        // The bot has been added. Check if there is an record in the database which is inactive
        // so we can activate that user
        if(relationshipStatus === steamApi.EFriendRelationship.RequestRecipient)
        {
            logger.debug(`Relationship event from ${steam64id}, status=${relationshipStatus}`);

            // Check if user is registered
            let isRegistered = await database.isRegisteredBySteam64Id(steam64id, true);
            if(isRegistered)
            {
                // Accept Steam friend request and set user as active in database
                database.setSteam64idActive(steam64id);
                this.SteamFriends.addFriend(steam64id);

                // Update the group of the user
                let csgoRankId = await this.getCSGORankOfSteam64id(steam64id);
                let tsUid = await database.getTsuid(steam64id);
                await exchangeChannel.postMessage(`update_rank ${tsUid} ${csgoRankId}`);

                //Log
                logger.debug(`Relationship event from ${steam64id} is ok, added to friendlist and updated rank in Teamspeak`);
            }
            else
            {
                // We have gotten a friend request from a user which is not registered in the database
                // We just decline this request
                logger.debug(`Relationship event from ${steam64id}, but is not in database. removing...`);
                this.SteamFriends.removeFriend(steam64id);
            }
        }


        // The bot has been removed from a friendslist. We need to remove that user from the database too
        else if (relationshipStatus === steamApi.EFriendRelationship.None) {
            logger.debug(`Got removed from ${steam64id} friendlist, removing too...`);

            //Check if user was really registered
            let isRegistered = await database.isRegisteredBySteam64Id(steam64id);
            if(isRegistered){
                database.deleteIdentity(steam64id);
                this.SteamFriends.removeFriend(steam64id);
            }
        }
    }


    /**
     * Event Handler for new messages received in the exchange data channel
     * @param msg
     * @returns {Promise<void>}
     */
    async exchangeChannelOnMessage(msg) {
        let cmd = msg.split(" ");

        switch (cmd[0].toLowerCase()) {
            case "request_update": {
                let tsUid = cmd[1];
                let steam64id = await database.getSteam64Id(tsUid);

                if(steam64id == null){
                    return;
                }

                let rankId = await this.getCSGORankOfSteam64id(steam64id);
		console.log("XXXXXX request update rank id ${rankId}");
		console.log(rankId);
		console.log(steam64id);
		console.log(tsUid);
                await exchangeChannel.postMessage(`update_rank ${tsUid} ${rankId}`);
            }
            break;
            case "update_tick_get_rank": {
                let tsUid = cmd[1];
                let steam64id = await database.getSteam64Id(tsUid);

                if(steam64id == null){
                    return;
                }

                let rankId = await this.getCSGORankOfSteam64id(steam64id);
		console.log("XXXXXX tick update rank id ${rankId}");
		console.log(rankId);
		console.log(steam64id);
		console.log(tsUid);
                await exchangeChannel.postMessage(`update_tick_update_rank ${tsUid} ${rankId}`);
            }
            break;
        }
    }



    /**
     * Initializes the Steam API and connects to the servers
     */
    startSteam() {
        logger.info("Starting steam interface");
        let _self = this;


        // Try to use saved server list, else use precompiled
        if (fs.existsSync('./config/.steamservers'))
        {
            let steamServers = null;

            try
            {
                logger.debug("Found .steamservers file, trying to use it");
                steamServers = JSON.parse(fs.readFileSync("./config/.steamservers") );
            }
            catch (e)
            {
                logger.warn("Could not read .steamservers file in config directory. Please delete it!");
                steamServers = JSON.parse(`[{"host":"162.254.195.47","port":27019},{"host":"162.254.195.47","port":27018},{"host":"162.254.195.46","port":27017},{"host":"162.254.195.44","port":27018},{"host":"162.254.195.45","port":27018},{"host":"162.254.195.44","port":27019},{"host":"162.254.195.45","port":27019},{"host":"162.254.195.44","port":27017},{"host":"162.254.195.46","port":27019},{"host":"162.254.195.45","port":27017},{"host":"162.254.195.46","port":27018},{"host":"162.254.195.47","port":27017},{"host":"162.254.193.47","port":27018},{"host":"162.254.193.6","port":27017},{"host":"162.254.193.46","port":27017},{"host":"162.254.193.7","port":27019},{"host":"162.254.193.6","port":27018},{"host":"162.254.193.6","port":27019},{"host":"162.254.193.47","port":27017},{"host":"162.254.193.46","port":27019},{"host":"162.254.193.7","port":27018},{"host":"162.254.193.47","port":27019},{"host":"162.254.193.7","port":27017},{"host":"162.254.193.46","port":27018},{"host":"155.133.254.132","port":27017},{"host":"155.133.254.132","port":27018},{"host":"205.196.6.75","port":27017},{"host":"155.133.254.133","port":27019},{"host":"155.133.254.133","port":27017},{"host":"155.133.254.133","port":27018},{"host":"155.133.254.132","port":27019},{"host":"205.196.6.67","port":27018},{"host":"205.196.6.67","port":27017},{"host":"205.196.6.75","port":27019},{"host":"205.196.6.67","port":27019},{"host":"205.196.6.75","port":27018},{"host":"162.254.192.108","port":27018},{"host":"162.254.192.100","port":27017},{"host":"162.254.192.101","port":27017},{"host":"162.254.192.108","port":27019},{"host":"162.254.192.109","port":27019},{"host":"162.254.192.100","port":27018},{"host":"162.254.192.108","port":27017},{"host":"162.254.192.101","port":27019},{"host":"162.254.192.109","port":27018},{"host":"162.254.192.101","port":27018},{"host":"162.254.192.109","port":27017},{"host":"162.254.192.100","port":27019},{"host":"162.254.196.68","port":27019},{"host":"162.254.196.83","port":27019},{"host":"162.254.196.68","port":27017},{"host":"162.254.196.67","port":27017},{"host":"162.254.196.67","port":27019},{"host":"162.254.196.83","port":27017},{"host":"162.254.196.84","port":27019},{"host":"162.254.196.84","port":27017},{"host":"162.254.196.83","port":27018},{"host":"162.254.196.68","port":27018},{"host":"162.254.196.84","port":27018},{"host":"162.254.196.67","port":27018},{"host":"155.133.248.53","port":27017},{"host":"155.133.248.50","port":27017},{"host":"155.133.248.51","port":27017},{"host":"155.133.248.52","port":27019},{"host":"155.133.248.53","port":27019},{"host":"155.133.248.52","port":27018},{"host":"155.133.248.52","port":27017},{"host":"155.133.248.51","port":27019},{"host":"155.133.248.53","port":27018},{"host":"155.133.248.50","port":27018},{"host":"155.133.248.51","port":27018},{"host":"155.133.248.50","port":27019},{"host":"155.133.246.69","port":27017},{"host":"155.133.246.68","port":27018},{"host":"155.133.246.68","port":27017},{"host":"155.133.246.69","port":27018},{"host":"155.133.246.68","port":27019},{"host":"155.133.246.69","port":27019},{"host":"162.254.197.42","port":27018},{"host":"146.66.152.10","port":27018}]`);
            }

            steamApi.servers = steamServers;
        }
        else
        {
            steamApi.servers = JSON.parse(`[{"host":"162.254.195.47","port":27019},{"host":"162.254.195.47","port":27018},{"host":"162.254.195.46","port":27017},{"host":"162.254.195.44","port":27018},{"host":"162.254.195.45","port":27018},{"host":"162.254.195.44","port":27019},{"host":"162.254.195.45","port":27019},{"host":"162.254.195.44","port":27017},{"host":"162.254.195.46","port":27019},{"host":"162.254.195.45","port":27017},{"host":"162.254.195.46","port":27018},{"host":"162.254.195.47","port":27017},{"host":"162.254.193.47","port":27018},{"host":"162.254.193.6","port":27017},{"host":"162.254.193.46","port":27017},{"host":"162.254.193.7","port":27019},{"host":"162.254.193.6","port":27018},{"host":"162.254.193.6","port":27019},{"host":"162.254.193.47","port":27017},{"host":"162.254.193.46","port":27019},{"host":"162.254.193.7","port":27018},{"host":"162.254.193.47","port":27019},{"host":"162.254.193.7","port":27017},{"host":"162.254.193.46","port":27018},{"host":"155.133.254.132","port":27017},{"host":"155.133.254.132","port":27018},{"host":"205.196.6.75","port":27017},{"host":"155.133.254.133","port":27019},{"host":"155.133.254.133","port":27017},{"host":"155.133.254.133","port":27018},{"host":"155.133.254.132","port":27019},{"host":"205.196.6.67","port":27018},{"host":"205.196.6.67","port":27017},{"host":"205.196.6.75","port":27019},{"host":"205.196.6.67","port":27019},{"host":"205.196.6.75","port":27018},{"host":"162.254.192.108","port":27018},{"host":"162.254.192.100","port":27017},{"host":"162.254.192.101","port":27017},{"host":"162.254.192.108","port":27019},{"host":"162.254.192.109","port":27019},{"host":"162.254.192.100","port":27018},{"host":"162.254.192.108","port":27017},{"host":"162.254.192.101","port":27019},{"host":"162.254.192.109","port":27018},{"host":"162.254.192.101","port":27018},{"host":"162.254.192.109","port":27017},{"host":"162.254.192.100","port":27019},{"host":"162.254.196.68","port":27019},{"host":"162.254.196.83","port":27019},{"host":"162.254.196.68","port":27017},{"host":"162.254.196.67","port":27017},{"host":"162.254.196.67","port":27019},{"host":"162.254.196.83","port":27017},{"host":"162.254.196.84","port":27019},{"host":"162.254.196.84","port":27017},{"host":"162.254.196.83","port":27018},{"host":"162.254.196.68","port":27018},{"host":"162.254.196.84","port":27018},{"host":"162.254.196.67","port":27018},{"host":"155.133.248.53","port":27017},{"host":"155.133.248.50","port":27017},{"host":"155.133.248.51","port":27017},{"host":"155.133.248.52","port":27019},{"host":"155.133.248.53","port":27019},{"host":"155.133.248.52","port":27018},{"host":"155.133.248.52","port":27017},{"host":"155.133.248.51","port":27019},{"host":"155.133.248.53","port":27018},{"host":"155.133.248.50","port":27018},{"host":"155.133.248.51","port":27018},{"host":"155.133.248.50","port":27019},{"host":"155.133.246.69","port":27017},{"host":"155.133.246.68","port":27018},{"host":"155.133.246.68","port":27017},{"host":"155.133.246.69","port":27018},{"host":"155.133.246.68","port":27019},{"host":"155.133.246.69","port":27019},{"host":"162.254.197.42","port":27018},{"host":"146.66.152.10","port":27018}]`);
        }


        //Connect to Steam
        this.SteamClient.connect();


        //Server list update event
        this.SteamClient.on('servers', function (servers)
        {
            try
            {
                fs.writeFile('./config/.steamservers', JSON.stringify(servers));
                logger.info("Updated .steamservers file!");
            }
            catch (e) {
                logger.warn('Could not write new steam servers file!');
                logger.warn(e.message);
            }

            steamApi.servers = servers;
        });



        //Steam Connected Event
        this.SteamClient.on('connected', function ()
        {
            _self.SteamUser.logOn(config.steamConfig);
        });


        //Friendrequest event
        this.SteamFriends.on('friend', (steam64id, relationshipStatus) => {
            this.onRelationshipChange(steam64id, relationshipStatus);
        });


        //Relationship event
        this.SteamFriends.on('relationships', (steam64id, relationshipStatus) => {
            this.onRelationshipChange(steam64id, relationshipStatus);
        });


        //Steam Login Event
        this.SteamClient.on('logOnResponse', (response) => {
            console.log(response);
	    if(response.eresult === steamApi.EResult.OK)
            {
                logger.info("Steam interface logged in successful");

                //Set profile url
                module.exports.steamProfileUrl = "https://steamcommunity.com/profiles/" + response.client_supplied_steamid;
            }
            else
            {
                logger.error("Steam interface could not log in!");
                process.exit(1);
            }

            //Set online
            _self.SteamFriends.setPersonaState(steamApi.EPersonaState.Online);

            //Start CSGO interface
            logger.info("Starting CSGO interface");
            _self.CSGOCli.launch();
            _self.CSGOCli.on('ready', () =>
            {
                logger.info("CSGO interface ready!");
            });
        });

        exchangeChannel.addEventListener('message', (msg) => { this.exchangeChannelOnMessage(msg); });
    };



    /**
     * Returns the steam64id of the steam profile
     * @param communityUrl URL of the steam profile
     */
    static async getSteamIdFromProfile(communityUrl) {

        let data = await rp(communityUrl);

        //Parse XML (we need to get the steamID64 tag)
        let document = new xmldoc.XmlDocument(data);
        let child = document.childNamed("steamID64");

        if(child !== undefined){
            return child.val;
        }
        return null;
    };
}

module.exports = Steam;
