import MiniSearch from 'minisearch';
import express from 'express';
import cors from 'cors';
import basicAuth from 'express-basic-auth'
import {promises as fs} from 'fs';
import lockfile from 'proper-lockfile'

// this is the name of the index file on disk
const indexFile = 'index.idx';

// define the index:
// - index the fields 'title', 'excerpt', 'tags'
// - store the fields 'title', 'excerpt', 'tags', 'path' (for search result generation later on)
// - define a custom field extractor that allows for indexing array types (the 'tags' fields)
const indexOptions = {
    fields: ['title', 'excerpt', 'tags'],
    storeFields: ['title', 'excerpt', 'tags', 'path'],
    extractField: (document, fieldName) => {
        if (Array.isArray(document[fieldName])) {
            return document[fieldName].join(' ');
        } else {
            return document[fieldName];
        }
    }
};

// the users allowed to modify the index (using basic auth)
const indexUsers = {'indexer': 'OjLAtxQXBKDxRK'};

// the express server port
const expressPort = 3000;

// the index and a timeout for deferred index file writing
let index;
let storeIndexTimeout;

// start by restoring the index from disk (will create a new one if one does not exist)
await restoreIndex();

// define the express app and setup basic auth middleware for the indexing operations
const app = express();
const basicAuthMiddleware = basicAuth({users: indexUsers});
app.use((req, res, next) =>
    req.originalUrl.startsWith('/index') ? basicAuthMiddleware(req, res, next) : next()
);
app.use(express.json());

// the search endpoint
app.get('/search/:query', cors(), (req, res) => {
    const results = index.search(
        req.params.query,
        {
            // use AND for multi-word queries (default is OR)
            combineWith: 'AND',
            // use trailing wildcard for terms that are 3 chars or longer
            prefix: term => term.length > 2
        }
    );
    
    // pagination - skip/take in query string (defaults to 0 and 10, respectively)
    const skip = req.query.skip ? parseInt(req.query.skip) : 0;
    const take = req.query.take ? parseInt(req.query.take) : 10;
    // create an output that is immediately consumable by clients
    const items = results.slice(skip, skip + take).map((result) => ({
        id: result.id,
        path: result.path,
        title: result.title,
        excerpt: result.excerpt,
        tags: result.tags.split(' ')
    }));
    res.json({
        total: results.length,
        items: items
    });
});

// the index endpoint
// NOTE: this is built to work with the Umbraco webhooks for content. therefore it is NOT a property REST endpoint,
//       as it needs to handle both create, update and delete in one POST endpoint.
app.post('/index', (req, res) => {
    // the 'umb-webhook-event' header value contains the instruction on what to do (create/update or delete)
    const event = req.headers['umb-webhook-event'];
    if (!event) {
        res.status(400).send('Malformed request (missing umb-webhook-event header)');
        return;
    }

    // get the request body and sanity check
    const data = req.body;
    if (!data.Id) {
        res.status(400).send('Malformed request body (missing id)');
        return;
    }

    // figure out what to do based on the event header value
    // NOTE: the casing of the data is a little skewed with Umbraco webhooks (V12 + V13); everything is
    //       PascalCased except from the property aliases, which are (usually) camelCased.
    switch (event) {
        // content published => create/update the document in the index 
        case 'Umbraco.ContentPublish':
            if (!data.Properties || !data.Route?.Path) {
                res.status(400).send('Malformed request body (missing path and/or properties)');
                return;
            }
            // construct a document for the index
            const doc = {
                id: data.Id,
                path: data.Route.Path,
                title: data.Name,
                excerpt: data.Properties.excerpt,
                tags: data.Properties.tags
            };
            // add/update the index
            if (index.has(doc.id)) {
                index.replace(doc);
            } else {
                index.add(doc);
            }
            // persist the index on disk (deferred!) and yield a 200 OK
            storeIndex().then(() => res.status(200).send());
            break;
        // content unpublished or deleted => delete the document from the index 
        case 'Umbraco.ContentUnpublish':
        case 'Umbraco.ContentDelete':
            index.discard(data.Id);
            // persist the index on disk (deferred!) and yield a 200 OK
            storeIndex().then(() => res.status(200).send());
            break;
    }
});

// start the express app
app.listen(expressPort, () => console.log(`The search service is running on http://localhost:${expressPort}.`));

// stores the index on disk
async function storeIndex() {
    // defer writing by a second, in case multiple indexing requests are made within a short period
    clearTimeout(storeIndexTimeout);
    storeIndexTimeout = setTimeout(async () => {
        console.log('Storing index on disk...');

        // lock the index file before writing
        const release = await lockfile.lock(indexFile);
        try {
            await writeIndexFile();
        } catch (err) {
            console.error(`Error writing index to disk: ${err.code}, index has not been persisted.`);
        }
        // release the index file lock
        await release();
    }, 1000);
}

// restores the index from disk (creates a new index if no index file is found)
async function restoreIndex() {
    console.log('Restoring index from disk...');
    let release;
    try {
        // lock the index file before reading
        release = await lockfile.lock(indexFile);
        const data = await fs.readFile(indexFile, {encoding: 'utf8'});
        // IMPORTANT: the index must be loaded with the same options as it was originally created with
        index = MiniSearch.loadJSON(data, indexOptions);
        console.debug(`Index restored successfully from disk - contains ${index.documentCount} documents.`);
    } catch (err) {
        switch (err.code) {
            // no such file on disk - expected scenario
            case 'ENOENT':
                console.log('No index found on disk, creating an empty index.');
                break;
            // something else went wrong - log it as an error
            default:
                console.error(`Error reading index on disk: ${err.code}, a new empty index will be created.`);
                break;
        }
        // create an empty index (nothing else we can really do at this point)
        index = new MiniSearch(indexOptions);
        // write the index to disk to avoid further file system issues e.g. at index time
        await writeIndexFile();
    }
    if (release) {
        // release the index file lock
        await release();
    }
}

// writes the index file to disk - ideally this only be called in a locked state
async function writeIndexFile() {
    const data = JSON.stringify(index);
    await fs.writeFile(indexFile, data);
    console.debug('Index successfully stored on disk.');
}
