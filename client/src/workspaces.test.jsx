import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { selectView } from './test-navigation.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const movie = { provider:'tmdb',type:'MOVIE',providerId:'42',id:'tmdb:MOVIE:42',title:'Arrival',image:'https://example.test/arrival.jpg',bannerImage:null,originalTitle:null,alternativeTitles:[],description:null,releaseDate:null,releaseStatus:'RELEASED',genres:[],creators:[],providerRating:null,isAdult:false,metadata:{runtimeMinutes:116} };
const item = { id:'00000000-0000-4000-8000-000000000001',provider:'tmdb',type:'MOVIE',providerId:'42',favorite:true,libraryStatus:'PLANNING',personalRating:null,note:null,progress:null,tags:[],collections:[],createdAt:'2026-09-10T00:00:00Z',updatedAt:'2026-09-10T00:00:00Z' };
function installFetch() {
  vi.stubGlobal('fetch',vi.fn(async url => ({ok:true,status:200,json:async()=>{
    if(url==='/api/health') return {status:'ok',service:'goraku-base-api'};
    if(url==='/api/auth/me') return {id:'reader',email:'reader@example.test'};
    if(url.startsWith('/api/media/tmdb/movie/42')) return movie;
    return {results:url.startsWith('/api/library?')?[item]:[],pagination:{page:1,perPage:20,hasMore:false},source:'tmdb',providerErrors:[]};
  }})));
}

it('changes workspace only through sidebar selection and retains search drafts', () => {
  installFetch(); render(<App />);
  expect(screen.getByRole('region',{name:'Discover workspace'})).toBeVisible();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  selectView('Search');
  const input=screen.getByRole('searchbox',{name:'Search anime by title'});
  fireEvent.change(input,{target:{value:'unfinished query'}});
  fireEvent.scroll(screen.getByRole('main'),{target:{scrollTop:10000}});
  expect(screen.getByRole('region',{name:'Search workspace'})).toBeVisible();
  expect(screen.queryByRole('region',{name:'Discover workspace'})).not.toBeInTheDocument();
  selectView('Account');
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  selectView('Search');
  expect(screen.getByRole('searchbox')).toHaveValue('unfinished query');
});

it('shows a restored favorite title and cover while keeping tracking collapsed', async () => {
  installFetch(); render(<App />); selectView('My Library');
  expect(await screen.findByRole('heading',{name:'Arrival'})).toBeVisible();
  const cover=screen.getByRole('img',{name:'Arrival cover'});
  expect(cover).toHaveAttribute('src',movie.image);
  expect(screen.getByRole('checkbox',{name:'Favorite TMDB movie 42'})).not.toBeVisible();
  fireEvent.click(screen.getByText('Edit tracking for Arrival'));
  expect(screen.getByRole('checkbox',{name:'Favorite TMDB movie 42'})).toBeChecked();
  fireEvent.error(cover);
  expect(screen.getByText('Cover unavailable')).toBeVisible();
  expect(screen.getByRole('heading',{name:'Arrival'})).toBeVisible();
});
