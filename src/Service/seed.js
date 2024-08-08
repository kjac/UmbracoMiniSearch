process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const posts = [];
const pageSize = 10;
const username = 'indexer';
const password = 'OjLAtxQXBKDxRK';
const umbracoHost = `https://localhost:44316`;
const indexHost = `http://localhost:3000`;

function umbracoApiRequest() {
    return `${umbracoHost}/umbraco/delivery/api/v2/content?filter=contentType:post&skip=${posts.length}&take=${pageSize}&fields=properties[excerpt,tags]`;
}

let response = await fetch(umbracoApiRequest());
let json = await response.json();

posts.push(...json.items);
while(posts.length < json.total) {
    response = await fetch(umbracoApiRequest());
    json = await response.json();
    posts.push(...json.items);
}

for(let i=0; i<posts.length; i++){
    const post = posts[i];
    console.log(`Indexing #${i} - ${post.name}`)
    response = await fetch(
        `${indexHost}/index/`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(username + ':' + password).toString('base64')}`,
                'umb-webhook-event': 'Umbraco.ContentPublish'
            },
            body: JSON.stringify({
                Id: post.id,
                Route: {
                    Path: post.route.path
                },
                Name: post.name,
                Properties: {
                    excerpt: post.properties.excerpt,
                    tags: post.properties.tags
                }
            })
        });
    if(!response.ok){
        console.error(`Indexing failed: ${response.statusText}`)
        break;
    }
}
